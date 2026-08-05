// VFlow360 Kommo — kommo-dashboard
// Agrega kommo.leads (+ pipelines/users/loss_reasons/custom_fields/settings) em
// DashboardData (mesmo formato do ghl-dashboard, para o frontend reusar sem mudança).
// Schema `kommo`, isolado. Partes que dependem de conversas/mensagens (tempo de
// resposta) ficam zeradas até a Fase 2. "Leads esfriando" NÃO é calculado aqui —
// vive isolado na edge function `cooling-leads` (tela dedicada /leads-esfriando).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { fetchAllRows } from "../_shared/paginate.ts";
import { authorizeWorkspace } from "../_shared/authorize.ts";
import { buildBucketResolver, parseFunnelMapping } from "../_shared/kommo-funnel.ts";
import { KommoDashboardPayloadSchema, CustomMetricsListSchema, CustomFiltersListSchema } from "../_shared/schemas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAY_MS = 86_400_000;

// Data-calendário (YYYY-MM-DD) em horário de Brasília. en-CA formata como YYYY-MM-DD.
const BRT_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});
function brtDate(d: Date): string {
  return BRT_DATE_FMT.format(d);
}
type Bucket = "contato_inicial" | "proposta_enviada" | "fechamento" | "venda_ganha";
const VALID_BUCKETS: Bucket[] = ["contato_inicial", "proposta_enviada", "fechamento", "venda_ganha"];

interface KommoStatus { id: string; name: string; sort?: number; type?: number; }

function inferFunnelMapping(stages: KommoStatus[]): Record<Bucket, string[]> {
  const out: Record<Bucket, string[]> = { contato_inicial: [], proposta_enviada: [], fechamento: [], venda_ganha: [] };
  for (const s of stages) {
    const id = String(s.id);
    if (id === "142") { out.venda_ganha.push(id); continue; }
    if (id === "143") continue; // perdido nunca entra no funil
    const n = (s.name || "").toLowerCase();
    if (/(ganho|ganha|won|venda)/.test(n)) out.venda_ganha.push(id);
    else if (/(fechamento|closing|negocia|proposta enviada)/.test(n)) out.fechamento.push(id);
    else if (/(proposta|proposal|enviar|oferta|reuni)/.test(n)) out.proposta_enviada.push(id);
    else out.contato_inicial.push(id);
  }
  if (!out.venda_ganha.includes("142")) out.venda_ganha.push("142");
  return out;
}

/** Extrai valor de um custom field de lead (array custom_fields_values) por code/id. */
function extractCf(cfv: any, codeOrId: string | null): string | null {
  if (!codeOrId || !Array.isArray(cfv)) return null;
  for (const f of cfv) {
    if (String(f?.field_code ?? "") === codeOrId || String(f?.field_id ?? "") === codeOrId) {
      const vals = (f?.values ?? []).map((v: any) => v?.value).filter((v: any) => v != null && String(v).trim() !== "");
      return vals.length ? vals.join(", ") : null;
    }
  }
  return null;
}

/** Valor de um custom field do tipo DATA como Date (Kommo grava unix em segundos). */
function extractCfDate(cfv: any, codeOrId: string | null): Date | null {
  const vals = extractCfValues(cfv, codeOrId);
  if (!vals.length) return null;
  const n = Number(vals[0]);
  if (!Number.isFinite(n)) {
    const d = new Date(vals[0]);
    return isNaN(d.getTime()) ? null : d;
  }
  // unix em segundos (Kommo) → ms
  return new Date(n * 1000);
}

/** Como extractCf, mas devolve cada valor individualmente (p/ multiselect e distribuição). */
function extractCfValues(cfv: any, codeOrId: string | null): string[] {
  if (!codeOrId || !Array.isArray(cfv)) return [];
  for (const f of cfv) {
    if (String(f?.field_code ?? "") === codeOrId || String(f?.field_id ?? "") === codeOrId) {
      return (f?.values ?? [])
        .map((v: any) => v?.value)
        .filter((v: any) => v != null && String(v).trim() !== "")
        .map((v: any) => String(v));
    }
  }
  return [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "kommo" } });

    const payload = KommoDashboardPayloadSchema.parse(await req.json().catch(() => ({})));
    const workspaceId = payload.workspace_id;

    // Auth: JWT válido + membership (usuário) OU segredo interno (cron). Ver
    // _shared/authorize.ts — request sem usuário e sem segredo é rejeitado.
    await authorizeWorkspace({ req, db, supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, workspaceId });

    const startDate = payload.startDate;
    const endDate = payload.endDate;
    // Eixo de data do período principal:
    //   - "criacao"    (default) → filtra por kommo_created_at  → aba Comercial
    //   - "fechamento"           → filtra por closed_at (ganho+perdido) → aba Financeiro
    // Sem o parâmetro, o comportamento é idêntico ao histórico (criação).
    const dateBasis = payload.dateBasis;
    const additionalStartDate = payload.additionalStartDate;
    const additionalEndDate = payload.additionalEndDate;
    const rawFilterPipelineIds = payload.pipelineId;
    const filterStageIds = payload.stageIds;
    const filterUserIds = payload.sellerIds;
    const filterUtmMediums = payload.utmMedium;
    const filterUtmCampaigns = payload.utmCampaign;
    const filterOrigins = payload.origin;
    const filterCustomFilters = payload.customFilters;

    // ===== Catálogos =====
    const [{ data: pipelinesRows }, { data: usersRows }, { data: lossRows }, { data: settingsRow }, { data: cfRows }] = await Promise.all([
      // Só funis vivos: arquivado/apagado no Kommo não entra no seletor nem no cálculo.
      db.from("pipelines").select("kommo_id,name,statuses,is_main,sort")
        .eq("workspace_id", workspaceId).eq("is_archive", false).eq("is_deleted", false),
      db.from("users").select("kommo_id,name,is_active").eq("workspace_id", workspaceId),
      db.from("loss_reasons").select("kommo_id,name").eq("workspace_id", workspaceId),
      db.from("dashboard_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
      db.from("custom_fields").select("kommo_id,name,code,entity_type,field_type,enums").eq("workspace_id", workspaceId),
    ]);

    const allPipelines = (pipelinesRows || []) as Array<{ kommo_id: string; name: string; statuses: any; is_main: boolean; sort: number }>;
    // Funil arquivado/apagado (fora de `allPipelines`, que já só traz vivos) não filtra
    // leads — evita que um pipelineId salvo em localStorage de antes da migration
    // is_deleted volte a vazar dado de um funil morto.
    const allPipelineIds = new Set(allPipelines.map((p) => p.kommo_id));
    const filterPipelineIds: string[] = rawFilterPipelineIds.filter((id) => allPipelineIds.has(id));
    const usersList = (usersRows || []) as Array<{ kommo_id: string; name: string; is_active?: boolean }>;
    // Só vendedores ativos alimentam o filtro e o seed da performance; o mapa de
    // nomes (sellerNameMap) segue completo p/ resolver quem já teve venda mas foi desativado.
    const activeUsers = usersList.filter((u) => u.is_active !== false);
    const lossList = (lossRows || []) as Array<{ kommo_id: string; name: string }>;
    const settings = (settingsRow || {}) as any;
    const customFieldDefs = (cfRows || []) as Array<{ kommo_id: string; name: string; code: string | null; entity_type: string | null; field_type: string | null; enums: any }>;

    // ===== Data adicional (filtro ADITIVO/união) =====
    // O conjunto final = leads criados no período principal UNIÃO leads cuja data
    // adicional cai no período adicional (mesmo que criados fora do principal).
    // additional_date_field pode ser:
    //   - "__closed_won__"  → closed_at dos leads GANHOS (data da venda, nativo)
    //   - "__closed_lost__" → closed_at dos leads PERDIDOS (data da perda, nativo)
    //   - <kommo_id>         → um campo personalizado do tipo data
    const SENTINEL_WON = "__closed_won__";
    const SENTINEL_LOST = "__closed_lost__";
    const additionalDateFieldId: string | null = settings?.additional_date_field || null;
    const isClosedSentinel = additionalDateFieldId === SENTINEL_WON || additionalDateFieldId === SENTINEL_LOST;
    const additionalDateDef = (additionalDateFieldId && !isClosedSentinel)
      ? (customFieldDefs.find((d) => d.kommo_id === additionalDateFieldId)
        || customFieldDefs.find((d) => d.code === additionalDateFieldId))
      : null;
    const additionalDateConfigured = isClosedSentinel || !!additionalDateDef;
    const additionalActive = additionalDateConfigured && !!(additionalStartDate || additionalEndDate);

    // Field ids de UTM/Origem (usados tanto para filtrar leads quanto para as distribuições
    // abaixo). "Origem do lead" tem prioridade sobre UTM Source — ver `getOrigin`.
    const utmMediumField = settings?.utm_medium_field_id || "UTM_MEDIUM";
    const utmCampaignField = settings?.utm_campaign_field_id || "UTM_CAMPAIGN";
    const utmSourceField = settings?.utm_source_field_id || "UTM_SOURCE";
    const originFieldName = settings?.origin_field_name || null; // ex: code de "Origem do lead"
    const getOrigin = (l: any): string | null =>
      extractCf(l.custom_fields, originFieldName) || extractCf(l.custom_fields, utmSourceField) || l.source || null;

    // ===== Filtros Personalizados (kommo.dashboard_settings.custom_filters) =====
    // Config validada na leitura: entradas malformadas são descartadas em vez de
    // derrubar a request. Cada filtro mapeia um campo de lead p/ um dropdown extra.
    const customFiltersParsed = CustomFiltersListSchema.safeParse(settings?.custom_filters ?? []);
    const customFilterDefs = customFiltersParsed.success ? customFiltersParsed.data : [];

    const defaultPipelineIds: string[] = Array.isArray(settings?.default_pipeline_ids) ? settings.default_pipeline_ids : [];
    const activePipelines = filterPipelineIds.length
      ? allPipelines.filter((p) => filterPipelineIds.includes(p.kommo_id))
      : (defaultPipelineIds.length ? allPipelines.filter((p) => defaultPipelineIds.includes(p.kommo_id)) : allPipelines);
    const activeStages: KommoStatus[] = activePipelines.flatMap((p) => (Array.isArray(p.statuses) ? p.statuses : []) as KommoStatus[]);
    const activePipelineIds = new Set(activePipelines.map((p) => p.kommo_id));

    // Funnel mapping: chaves "<pipelineId>:<statusId>" (atual) ou "<statusId>"
    // (legado, vale p/ todos os funis). Ver _shared/kommo-funnel.ts.
    const parsedMapping = parseFunnelMapping(settings?.funnel_stage_mapping as Record<string, unknown>);
    // Inferência por nome preenche APENAS as fases que o usuário não configurou
    // (comportamento histórico: mapeamento vazio => funil todo inferido).
    const inferred = inferFunnelMapping(activeStages);
    const fallbackByStage = new Map<string, Bucket>();
    for (const b of VALID_BUCKETS) {
      if (parsedMapping.covered.has(b)) continue;
      for (const id of inferred[b]) if (!fallbackByStage.has(id)) fallbackByStage.set(id, b);
    }
    const bucketOf = buildBucketResolver(parsedMapping, fallbackByStage);

    // Ganho = status de sistema do Kommo (`won`, que é o status_id 142 do funil)
    // OU etapa mapeada como "Venda Ganha" NAQUELE funil. Antes havia um
    // `add("142")` global aqui, que fazia o 142 de qualquer funil contar como
    // venda — inclusive onde ele é outra coisa ("Cirurgia Realizada").
    const isWonLead = (l: any) => l.status === "won" || bucketOf(l.pipeline_id, l.status_id) === "venda_ganha";

    // ===== Query leads (paginada — PostgREST corta em 1000 por resposta) =====
    const leadsRows = await fetchAllRows((from, to) => {
      let q = db.from("leads")
        .select("kommo_id,name,pipeline_id,status_id,status,price,responsible_user_id,loss_reason_id,custom_fields,kommo_created_at,kommo_updated_at,closed_at,closest_task_at,contact_name")
        .eq("workspace_id", workspaceId).eq("is_deleted", false);
      if (filterPipelineIds.length === 1) q = q.eq("pipeline_id", filterPipelineIds[0]);
      else if (filterPipelineIds.length > 1) q = q.in("pipeline_id", filterPipelineIds);
      if (filterStageIds.length === 1) q = q.eq("status_id", filterStageIds[0]);
      else if (filterStageIds.length > 1) q = q.in("status_id", filterStageIds);
      if (filterUserIds.length === 1) q = q.eq("responsible_user_id", filterUserIds[0]);
      else if (filterUserIds.length > 1) q = q.in("responsible_user_id", filterUserIds);
      // Com filtro adicional ativo, não restringimos a data de criação no SQL — a união
      // (criado no período OU vendido no período adicional) é resolvida no JS abaixo.
      if (!additionalActive) {
        // Comercial → data de criação; Financeiro → data de fechamento (closed_at).
        // Comparar closed_at por gte/lte já exclui NULL, então o Financeiro traz
        // apenas leads fechados (ganho ou perdido) dentro do período.
        const periodColumn = dateBasis === "fechamento" ? "closed_at" : "kommo_created_at";
        if (startDate) q = q.gte(periodColumn, startDate);
        if (endDate) q = q.lte(periodColumn, endDate);
      }
      return q.order("kommo_id").range(from, to);
    });
    let leads = leadsRows as any[];
    if (!filterPipelineIds.length && activePipelineIds.size > 0) {
      leads = leads.filter((l) => !l.pipeline_id || activePipelineIds.has(l.pipeline_id));
    }
    // Snapshot ANTES de aplicar UTM Medium/Campanha/Origem: essas 3 listas de opções
    // (dropdowns) não podem encolher conforme o próprio filtro é aplicado.
    const leadsForFilterOptions = leads;
    if (filterUtmMediums.length) leads = leads.filter((l) => filterUtmMediums.includes(extractCf(l.custom_fields, utmMediumField) || ""));
    if (filterUtmCampaigns.length) leads = leads.filter((l) => filterUtmCampaigns.includes(extractCf(l.custom_fields, utmCampaignField) || ""));
    if (filterOrigins.length) leads = leads.filter((l) => filterOrigins.includes(getOrigin(l) || ""));
    for (const def of customFilterDefs) {
      const selected = filterCustomFilters[def.id];
      if (selected?.length) leads = leads.filter((l) => selected.includes(extractCf(l.custom_fields, def.fieldId) || ""));
    }

    // ===== Filtro ADITIVO por data adicional (ex.: "Data da venda") =====
    // Como o SQL trouxe os leads SEM restrição de criação (additionalActive), aqui
    // mantemos a UNIÃO: criado no período principal OU campo-de-data no período adicional.
    if (additionalActive) {
      const mainFrom = startDate ? new Date(startDate).getTime() : -Infinity;
      const mainTo = endDate ? new Date(endDate).getTime() : Infinity;
      const addFrom = additionalStartDate ? new Date(additionalStartDate).getTime() : -Infinity;
      const addTo = additionalEndDate ? new Date(additionalEndDate).getTime() : Infinity;
      // Data adicional de cada lead conforme o modo configurado.
      const additionalDateOf = (l: any): Date | null => {
        if (additionalDateFieldId === SENTINEL_WON) {
          const isWon = isWonLead(l);
          return isWon && l.closed_at ? new Date(l.closed_at as string) : null;
        }
        if (additionalDateFieldId === SENTINEL_LOST) {
          return l.status === "lost" && l.closed_at ? new Date(l.closed_at as string) : null;
        }
        return additionalDateDef
          ? (extractCfDate(l.custom_fields, additionalDateDef.code) ?? extractCfDate(l.custom_fields, additionalDateDef.kommo_id))
          : null;
      };
      leads = leads.filter((l) => {
        // O eixo principal segue o dateBasis: criação (Comercial) ou fechamento (Financeiro).
        const mainRef = dateBasis === "fechamento" ? l.closed_at : l.kommo_created_at;
        const mainTs = mainRef ? new Date(mainRef as string).getTime() : null;
        const inMain = mainTs !== null && mainTs >= mainFrom && mainTs <= mainTo;
        const ad = additionalDateOf(l);
        const inAdd = !!ad && ad.getTime() >= addFrom && ad.getTime() <= addTo;
        return inMain || inAdd;
      });
    }

    const safeRate = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
    // A fase depende do PAR funil+etapa: `142`/`143` repetem em todos os funis.
    const stageBucket = (pipelineId: string | null, statusId: string | null): Bucket | null =>
      bucketOf(pipelineId, statusId) as Bucket | null;

    // ===== Tempo por etapa (a partir do histórico de eventos) =====
    // Para cada lead, reconstrói os trechos (status, entrada, saída) usando created_at
    // + eventos de mudança de etapa, e tira a média de dias por balde do funil.
    const stageEvRows = await fetchAllRows((from, to) => db.from("lead_stage_events")
      .select("lead_id,pipeline_id,before_status_id,after_status_id,changed_at")
      .eq("workspace_id", workspaceId).order("id").range(from, to));
    const eventsByLead = new Map<string, Array<{ before: string | null; after: string | null; t: number }>>();
    for (const e of (stageEvRows || []) as any[]) {
      const t = e.changed_at ? new Date(e.changed_at).getTime() : NaN;
      if (!e.lead_id || isNaN(t)) continue;
      const arr = eventsByLead.get(String(e.lead_id)) || [];
      arr.push({ before: e.before_status_id ?? null, after: e.after_status_id ?? null, t });
      eventsByLead.set(String(e.lead_id), arr);
    }
    const computeTimePerStage = () => {
      const acc: Record<Exclude<Bucket, "venda_ganha">, { sum: number; n: number }> = {
        contato_inicial: { sum: 0, n: 0 }, proposta_enviada: { sum: 0, n: 0 }, fechamento: { sum: 0, n: 0 },
      };
      const now = Date.now();
      for (const l of leads) {
        const evs = (eventsByLead.get(String(l.kommo_id)) || []).slice().sort((a, b) => a.t - b.t);
        const created = l.kommo_created_at ? new Date(l.kommo_created_at as string).getTime() : null;
        const segs: Array<[string | null, number, number]> = [];
        if (evs.length === 0) {
          if (created != null) segs.push([l.status_id, created, now]);
        } else {
          if (created != null && evs[0].before) segs.push([evs[0].before, created, evs[0].t]);
          for (let i = 0; i < evs.length; i++) {
            segs.push([evs[i].after, evs[i].t, i + 1 < evs.length ? evs[i + 1].t : now]);
          }
        }
        for (const [status, enter, exit] of segs) {
          if (!status || exit < enter || status === "143") continue;
          const b = stageBucket(l.pipeline_id, status);
          if (b && b !== "venda_ganha") { acc[b].sum += (exit - enter); acc[b].n++; }
        }
      }
      // O componente do front formata em HORAS (depois converte para "Xd Yh").
      const toHours = (o: { sum: number; n: number }) => (o.n ? Math.round(o.sum / o.n / 3_600_000) : 0);
      return {
        contatoInicial: toHours(acc.contato_inicial),
        propostaEnviada: toHours(acc.proposta_enviada),
        fechamento: toHours(acc.fechamento),
      };
    };
    const averageTimePerStage = computeTimePerStage();

    // ===== Velocidade do funil (movimentação no período selecionado) =====
    const sortByStatus = new Map<string, number>();
    for (const p of allPipelines) {
      for (const s of (Array.isArray(p.statuses) ? p.statuses : []) as KommoStatus[]) {
        if (s && s.id != null && typeof s.sort === "number") sortByStatus.set(String(s.id), s.sort);
      }
    }
    const velFrom = startDate ? new Date(startDate).getTime() : -Infinity;
    const velTo = endDate ? new Date(endDate).getTime() : Infinity;
    const pipeOk = (pid: string | null) =>
      filterPipelineIds.length ? (!!pid && filterPipelineIds.includes(pid)) : (activePipelineIds.size === 0 || !pid || activePipelineIds.has(pid));
    const movedLeads = new Set<string>();
    const advancedLeads = new Set<string>();
    let movimentacoes = 0, velGanhos = 0, velPerdidos = 0;
    for (const e of (stageEvRows || []) as any[]) {
      const t = e.changed_at ? new Date(e.changed_at).getTime() : NaN;
      if (isNaN(t) || t < velFrom || t > velTo) continue;
      if (!pipeOk(e.pipeline_id ?? null)) continue;
      movimentacoes++;
      movedLeads.add(String(e.lead_id));
      const after = String(e.after_status_id ?? "");
      const before = String(e.before_status_id ?? "");
      if (after === "142") velGanhos++;
      if (after === "143") velPerdidos++;
      const sa = sortByStatus.get(after); const sb = sortByStatus.get(before);
      const forward = after === "142" || (sa != null && sb != null && sa > sb);
      if (forward && after !== "143") advancedLeads.add(String(e.lead_id));
    }
    const funnelVelocity = {
      movimentacoes,
      leadsMovidos: movedLeads.size,
      avancaram: advancedLeads.size,
      ganhos: velGanhos,
      perdidos: velPerdidos,
    };

    // ===== Follow-up / Tarefas =====
    const leadIdSet = new Set(leads.map((l) => String(l.kommo_id)));
    const openLeads = leads.filter((l) => l.status !== "lost" && !isWonLead(l));
    const leadsSemProximaAcao = openLeads.filter((l) => !l.closest_task_at).length;

    const taskRows = await fetchAllRows((from, to) => db.from("tasks")
      .select("lead_id,responsible_user_id,complete_till,is_completed")
      .eq("workspace_id", workspaceId).eq("is_completed", false).order("id").range(from, to));
    const fuNow = Date.now();
    const fuToday = brtDate(new Date());
    const sellerNameMap = new Map(usersList.map((u) => [u.kommo_id, u.name]));
    let tarefasAtrasadas = 0, tarefasHoje = 0;
    const overdueBySeller = new Map<string, number>();
    for (const t of (taskRows || []) as any[]) {
      if (!t.lead_id || !leadIdSet.has(String(t.lead_id))) continue; // respeita filtros (leads no escopo)
      const due = t.complete_till ? new Date(t.complete_till).getTime() : null;
      if (due == null) continue;
      if (due < fuNow) {
        tarefasAtrasadas++;
        const nm = (t.responsible_user_id && sellerNameMap.get(String(t.responsible_user_id))) || "Sem responsável";
        overdueBySeller.set(nm, (overdueBySeller.get(nm) || 0) + 1);
      } else if (brtDate(new Date(t.complete_till)) === fuToday) {
        tarefasHoje++;
      }
    }
    const followUp = {
      tarefasAtrasadas,
      tarefasHoje,
      leadsSemProximaAcao,
      porVendedor: Array.from(overdueBySeller.entries())
        .map(([name, atrasadas]) => ({ name, atrasadas }))
        .sort((a, b) => b.atrasadas - a.atrasadas).slice(0, 8),
    };

    const totalLeads = leads.length;
    const wonOpps = leads.filter((l) => isWonLead(l));
    const lostOpps = leads.filter((l) => l.status === "lost");
    const lostLeads = lostOpps.length;

    // ===== Funnel (4 buckets, exclui perdidos) =====
    const counts = { contato_inicial: 0, proposta_enviada: 0, fechamento: 0, venda_ganha: 0 };
    const leadsByBucket: Record<Bucket, Array<{ id: number; name: string; contactName: string | null }>> = { contato_inicial: [], proposta_enviada: [], fechamento: [], venda_ganha: [] };
    for (const l of leads) {
      if (l.status === "lost") continue;
      const b = stageBucket(l.pipeline_id, l.status_id);
      if (b) {
        counts[b]++;
        if (leadsByBucket[b].length < 200) {
          leadsByBucket[b].push({
            id: leadsByBucket[b].length + 1,
            name: l.name || `Lead ${String(l.kommo_id).slice(0, 6)}`,
            contactName: l.contact_name || null,
          });
        }
      }
    }
    const passage = {
      contato_inicial: counts.contato_inicial + counts.proposta_enviada + counts.fechamento + counts.venda_ganha,
      proposta_enviada: counts.proposta_enviada + counts.fechamento + counts.venda_ganha,
      fechamento: counts.fechamento + counts.venda_ganha,
      venda_ganha: counts.venda_ganha,
    };
    const funnelStages = [
      { id: "contato_inicial", name: "Contato Inicial", count: passage.contato_inicial, currentCount: counts.contato_inicial, leads: leadsByBucket.contato_inicial },
      { id: "proposta_enviada", name: "Proposta Enviada", count: passage.proposta_enviada, currentCount: counts.proposta_enviada, leads: leadsByBucket.proposta_enviada },
      { id: "fechamento", name: "Fechamento", count: passage.fechamento, currentCount: counts.fechamento, leads: leadsByBucket.fechamento },
      { id: "venda_ganha", name: "Venda Ganha", count: passage.venda_ganha, currentCount: counts.venda_ganha, leads: leadsByBucket.venda_ganha },
    ];
    const conversionRates = {
      contatoToProsposta: safeRate(passage.proposta_enviada, passage.contato_inicial),
      propostaToFechamento: safeRate(passage.fechamento, passage.proposta_enviada),
      fechamentoToVenda: safeRate(passage.venda_ganha, passage.fechamento),
      overallConversion: safeRate(passage.venda_ganha, passage.contato_inicial || totalLeads),
    };

    // ===== Sellers =====
    const sellersMap = new Map<string, any>();
    for (const u of activeUsers) sellersMap.set(u.kommo_id, { id: u.kommo_id, name: u.name, contatoInicial: 0, propostaEnviada: 0, fechamento: 0, vendaGanha: 0, wonRevenue: 0, avgResponseMinutes: null, responseCount: 0 });
    for (const l of leads) {
      const b = stageBucket(l.pipeline_id, l.status_id);
      if (!b) continue;
      const key = l.responsible_user_id || "__unassigned__";
      let s = sellersMap.get(key);
      if (!s) { s = { id: key, name: key === "__unassigned__" ? "Não atribuído" : (sellerNameMap.get(key) || `Usuário ${String(key).slice(0, 6)}`), contatoInicial: 0, propostaEnviada: 0, fechamento: 0, vendaGanha: 0, wonRevenue: 0, avgResponseMinutes: null, responseCount: 0 }; sellersMap.set(key, s); }
      if (b === "contato_inicial") s.contatoInicial++;
      else if (b === "proposta_enviada") s.propostaEnviada++;
      else if (b === "fechamento") s.fechamento++;
      else if (b === "venda_ganha") s.vendaGanha++;
    }
    // Receita ganha por vendedor (soma o valor dos leads ganhos por responsável).
    for (const l of wonOpps) {
      const key = l.responsible_user_id || "__unassigned__";
      const s = sellersMap.get(key);
      if (s) s.wonRevenue += Number(l.price) || 0;
    }
    const sellers = Array.from(sellersMap.values()).filter((s) => s.contatoInicial + s.propostaEnviada + s.fechamento + s.vendaGanha > 0);

    // ===== Origem / UTM =====
    const buildDist = (getter: (l: any) => string | null, subset: any[]) => {
      const m = new Map<string, number>(); let filled = 0;
      for (const l of subset) { const v = getter(l); if (v) { filled++; m.set(v, (m.get(v) || 0) + 1); } }
      const distribution = Array.from(m.entries()).map(([name, count]) => ({ name, count, percentage: safeRate(count, filled) })).sort((a, b) => b.count - a.count);
      return { distribution, fillRate: safeRate(filled, subset.length || 0) };
    };
    const origem = buildDist(getOrigin, leads);
    const wonOrigem = buildDist(getOrigin, wonOpps);
    // Listas de opções dos dropdowns (Tipo de origem/Campanha/Origem): calculadas sobre
    // `leadsForFilterOptions` (ANTES do próprio filtro ser aplicado), senão escolher um
    // valor faria a lista de opções encolher pra só ele mesmo na consulta seguinte.
    const utmMedium = buildDist((l) => extractCf(l.custom_fields, utmMediumField), leadsForFilterOptions);
    const utmCampaign = buildDist((l) => extractCf(l.custom_fields, utmCampaignField), leadsForFilterOptions);
    const originOptions = buildDist(getOrigin, leadsForFilterOptions);
    // Opções dos dropdowns dos filtros personalizados — mesma lógica (snapshot pré-filtro).
    const customFilterValues: Record<string, string[]> = {};
    for (const def of customFilterDefs) {
      customFilterValues[def.id] = buildDist((l) => extractCf(l.custom_fields, def.fieldId), leadsForFilterOptions)
        .distribution.map((d) => d.name);
    }

    // ===== Daily leads (7 dias) — agrupado por dia em horário de Brasília =====
    // O kommo_created_at é UTC; agrupar por UTC jogava leads da noite (BRT) para o
    // dia seguinte. Bucketiza pela data-calendário em America/Sao_Paulo.
    const endRef = endDate ? new Date(endDate) : new Date();
    const dayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    // Conta leads por data-calendário BRT
    // Eixo do gráfico segue o dateBasis: criação (Comercial) ou fechamento (Financeiro).
    const dailyDateOf = (l: any): string | null =>
      dateBasis === "fechamento" ? (l.closed_at || null) : (l.kommo_created_at || null);
    // `total` = todos os leads do dia (usado pelo Comercial). No Financeiro, `leads`
    // já só contém fechados (won/lost) então total === won+lost; no Comercial há
    // leads ainda abertos, então total > won+lost — por isso contamos os 3 à parte.
    const leadsByDay = new Map<string, { total: number; won: number; lost: number }>();
    for (const l of leads) {
      const ref = dailyDateOf(l);
      if (!ref) continue;
      const iso = brtDate(new Date(ref as string));
      const bucket = leadsByDay.get(iso) || { total: 0, won: 0, lost: 0 };
      bucket.total++;
      if (isWonLead(l)) bucket.won++;
      else if (l.status === "lost") bucket.lost++;
      leadsByDay.set(iso, bucket);
    }
    // Últimos 7 dias terminando no dia BRT de endRef (aritmética de calendário em UTC puro)
    const [ey, em, ed] = brtDate(endRef).split("-").map(Number);
    const dailyLeads: Array<{ date: string; count: number; won: number; lost: number; dayName: string }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.UTC(ey, em - 1, ed));
      d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const bucket = leadsByDay.get(iso) || { total: 0, won: 0, lost: 0 };
      dailyLeads.push({ date: iso, count: bucket.total, won: bucket.won, lost: bucket.lost, dayName: dayLabels[d.getUTCDay()] });
    }

    // ===== Loss reasons =====
    const lossMap = new Map<string, number>();
    for (const l of lostOpps) {
      const r = l.loss_reason_id ? lossList.find((x) => x.kommo_id === l.loss_reason_id)?.name : null;
      const key = r || "Não informado";
      lossMap.set(key, (lossMap.get(key) || 0) + 1);
    }
    const lossReasons = Array.from(lossMap.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

    // ===== Monetário =====
    const totalMonetary = leads.reduce((a, l) => a + (Number(l.price) || 0), 0);
    const wonMonetary = wonOpps.reduce((a, l) => a + (Number(l.price) || 0), 0);
    const lostMonetary = lostOpps.reduce((a, l) => a + (Number(l.price) || 0), 0);
    const negotiatingMonetary = leads.reduce((a, l) => {
      if (l.status === "lost") return a;
      const b = stageBucket(l.pipeline_id, l.status_id);
      return (b === "proposta_enviada" || b === "fechamento") ? a + (Number(l.price) || 0) : a;
    }, 0);

    // ===== Receita em pipeline aberto (foto do estado ATUAL, independente do período) =====
    // "Receita Ganha/Perdida" acima são cortes por período (data de criação ou fechamento);
    // isso aqui é "quanto está aberto agora", então busca de novo sem filtro de data, só
    // respeitando os mesmos filtros de funil/vendedor da tela.
    const openLeadsRows = await fetchAllRows((from, to) => {
      let q = db.from("leads")
        .select("pipeline_id,status_id,status,price,responsible_user_id")
        .eq("workspace_id", workspaceId).eq("is_deleted", false).neq("status", "lost");
      if (filterPipelineIds.length === 1) q = q.eq("pipeline_id", filterPipelineIds[0]);
      else if (filterPipelineIds.length > 1) q = q.in("pipeline_id", filterPipelineIds);
      if (filterUserIds.length === 1) q = q.eq("responsible_user_id", filterUserIds[0]);
      else if (filterUserIds.length > 1) q = q.in("responsible_user_id", filterUserIds);
      return q.order("kommo_id").range(from, to);
    });
    let openPipelineRevenue = 0;
    let openPipelineCount = 0;
    for (const l of (openLeadsRows || []) as any[]) {
      if (isWonLead(l)) continue;
      if (!filterPipelineIds.length && activePipelineIds.size > 0 && l.pipeline_id && !activePipelineIds.has(l.pipeline_id)) continue;
      openPipelineRevenue += Number(l.price) || 0;
      openPipelineCount++;
    }

    // ===== Ciclos (criação → fechamento) =====
    const cycleDays = (subset: any[]) => {
      let total = 0, n = 0;
      for (const l of subset) {
        if (!l.kommo_created_at || !l.closed_at) continue;
        const ms = new Date(l.closed_at).getTime() - new Date(l.kommo_created_at).getTime();
        if (ms < 0) continue; total += ms; n++;
      }
      return n === 0 ? { days: 0, sampleSize: 0 } : { days: Math.round((total / n / DAY_MS) * 10) / 10, sampleSize: n };
    };
    const cycleToWon = cycleDays(wonOpps);
    const cycleToLost = cycleDays(lostOpps);

    // ===== Qualidade de preenchimento dos campos personalizados (de lead) =====
    // visible_custom_fields guarda kommo_id; casa no lead por field_id OU field_code.
    const leadFieldDefs = customFieldDefs.filter((d) => (d.entity_type || "").toLowerCase() === "leads");
    const rawVisible: string[] = Array.isArray(settings?.visible_custom_fields) && settings.visible_custom_fields.length
      ? settings.visible_custom_fields
      : leadFieldDefs.slice(0, 8).map((d) => d.kommo_id);
    const customFields = rawVisible
      .map((key) => {
        const def = leadFieldDefs.find((d) => d.kommo_id === key)
          || leadFieldDefs.find((d) => d.code === key)
          || leadFieldDefs.find((d) => d.name === key);
        if (!def) return null;
        let filled = 0;
        for (const l of leads) {
          if (extractCf(l.custom_fields, def.code) !== null || extractCf(l.custom_fields, def.kommo_id) !== null) filled++;
        }
        const filledPercentage = safeRate(filled, totalLeads);
        return { name: def.name, filledPercentage, emptyPercentage: 100 - filledPercentage, totalLeads, filledCount: filled };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    const overallFillRate = customFields.length === 0
      ? 0
      : customFields.reduce((a, b) => a + b.filledPercentage, 0) / customFields.length;

    // ===== Distribuição por valor dos campos personalizados escolhidos p/ pizza =====
    // Respeita settings.chart_custom_fields (kommo_id dos campos de LEAD marcados em
    // "Personalizar Dashboard"). Casa por field_id OU field_code, como o resto.
    const chartFieldIds: string[] = Array.isArray(settings?.chart_custom_fields) ? settings.chart_custom_fields : [];
    const customFieldDistributions = chartFieldIds
      .map((key) => {
        const def = leadFieldDefs.find((d) => d.kommo_id === key)
          || leadFieldDefs.find((d) => d.code === key)
          || leadFieldDefs.find((d) => d.name === key);
        if (!def) return null;
        const m = new Map<string, number>();
        let filledCount = 0;
        for (const l of leads) {
          const vals = extractCfValues(l.custom_fields, def.code);
          const use = vals.length ? vals : extractCfValues(l.custom_fields, def.kommo_id);
          if (use.length) filledCount++;
          for (const v of use) m.set(v, (m.get(v) || 0) + 1);
        }
        const totalValues = Array.from(m.values()).reduce((a, b) => a + b, 0);
        const distribution = Array.from(m.entries())
          .map(([name, count]) => ({ name, count, percentage: safeRate(count, totalValues) }))
          .sort((a, b) => b.count - a.count);
        return { key: def.kommo_id, name: def.name, totalLeads, filledCount, distribution };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    // ===== Métricas Personalizadas (kommo.dashboard_settings.custom_metrics) =====
    // Config validada na leitura: entradas malformadas (ex.: editadas direto no banco)
    // são descartadas em vez de derrubar a request inteira.
    const customMetricsParsed = CustomMetricsListSchema.safeParse(settings?.custom_metrics ?? []);
    const customMetricsConfig = customMetricsParsed.success ? customMetricsParsed.data : [];
    // "Está em": lead cujo status atual é uma das etapas configuradas.
    const countCurrentlyIn = (refs: { pipelineId: string; statusId: string }[]) => {
      const keys = new Set(refs.map((r) => `${r.pipelineId}:${r.statusId}`));
      let n = 0;
      for (const l of leads) {
        if (l.pipeline_id && l.status_id && keys.has(`${l.pipeline_id}:${l.status_id}`)) n++;
      }
      return n;
    };
    // "Passou por": lead que está atualmente na etapa OU tem, no histórico real
    // (lead_stage_events, já carregado acima), um evento de entrada nela. Igual ao
    // resto do arquivo, resolve a etapa pelo pipeline ATUAL do lead (não por
    // pipeline gravado no evento) — evita colisão de status_id repetido entre funis.
    const countPassedThrough = (refs: { pipelineId: string; statusId: string }[]) => {
      if (refs.length === 0) return 0;
      let n = 0;
      for (const l of leads) {
        if (!l.pipeline_id) continue;
        const targetStatusIds = new Set(refs.filter((r) => r.pipelineId === l.pipeline_id).map((r) => r.statusId));
        if (targetStatusIds.size === 0) continue;
        if (l.status_id && targetStatusIds.has(l.status_id)) { n++; continue; }
        const evs = eventsByLead.get(String(l.kommo_id)) || [];
        if (evs.some((e) => e.after && targetStatusIds.has(e.after))) n++;
      }
      return n;
    };
    const customMetrics = customMetricsConfig.map((m) => {
      const passed = countPassedThrough(m.numerator);
      if (m.format === "number") return { id: m.id, name: m.name, format: m.format, icon: m.icon, value: passed };
      const base = countCurrentlyIn(m.denominator);
      return { id: m.id, name: m.name, format: m.format, icon: m.icon, value: base > 0 ? (passed / base) * 100 : null };
    });

    return new Response(JSON.stringify({
      totalLeads, lostLeads,
      lostLeadsDetail: lostOpps.slice(0, 200).map((l, i) => ({ id: i + 1, name: l.name || `Lead ${String(l.kommo_id).slice(0, 6)}`, contactName: l.contact_name || null })),
      funnelStages, conversionRates, sellers,
      // Origens/UTM: só os campos realmente consumidos. Os cards de origem usam
      // leadsOriginDistribution/wonOriginDistribution; os selects de filtro usam
      // utm{Medium,Campaign}Values. (Duplicatas legadas removidas — 2026-07-21.)
      utmMediumValues: utmMedium.distribution.map((d) => d.name),
      utmCampaignValues: utmCampaign.distribution.map((d) => d.name),
      originValues: originOptions.distribution.map((d) => d.name),
      leadsOriginDistribution: origem.distribution, leadsOriginFillRate: origem.fillRate,
      wonOriginDistribution: wonOrigem.distribution, wonOriginFillRate: wonOrigem.fillRate,
      utmConfigured: { source: true, medium: true, campaign: true, content: true, term: true },
      customFilterDefs: customFilterDefs.map((d) => ({ id: d.id, label: d.label })),
      customFilterValues,
      customFields, customFieldDistributions,
      averageTimePerStage,
      funnelVelocity,
      followUp,
      cycleToWonDays: cycleToWon.days, cycleToWonSample: cycleToWon.sampleSize,
      cycleToLostDays: cycleToLost.days, cycleToLostSample: cycleToLost.sampleSize,
      dailyLeads,
      pipelines: allPipelines.map((p) => ({ id: p.kommo_id, name: p.name, stages: Array.isArray(p.statuses) ? p.statuses : [] })),
      users: activeUsers.map((u) => ({ id: u.kommo_id, name: u.name })),
      overallFillRate, lossReasons,
      totalMonetary, wonMonetary, lostMonetary, negotiatingMonetary, openPipelineRevenue, openPipelineCount,
      // Fase 2 (dependem de conversas/mensagens):
      responseTime: { averageMinutes: 0, responseCount: 0, conversationsAnalyzed: 0, conversationsWithInbound: 0, businessHoursStart: settings?.business_hours_start || "09:00", businessHoursEnd: settings?.business_hours_end || "18:00", unanswered: [] },
      customMetrics,
      cachedAt: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    // Body fora do formato esperado (ex.: sem workspace_id) → 400 com mensagem clara.
    if (err instanceof z.ZodError) {
      const msg = err.errors.map((e) => `${e.path.join(".") || "body"}: ${e.message}`).join("; ");
      console.error("kommo-dashboard payload inválido:", msg);
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const msg = err instanceof Error ? err.message : (err && typeof err === "object" && (err as any).message ? `${(err as any).message} | ${(err as any).code ?? ""}` : String(err));
    console.error("kommo-dashboard error:", msg);
    // Acesso negado → 403 (consistente com kommo-sync); demais falhas → 500.
    const status = msg === "Forbidden" || msg === "Missing authorization" ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
