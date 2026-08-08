// VFlow360 Kommo — kommo-report-snapshot
// Calcula as FOTOS MENSAIS congeladas e grava em kommo.report_snapshots.
// Um único "recompute" cobre backfill + fechamento: agrupa os leads por mês (em
// horário de Brasília) nos dois eixos (criacao=kommo_created_at, fechamento=closed_at),
// e faz upsert. Mês-calendário corrente => is_partial=true; meses anteriores => congelados.
// Escopo do funil segue o default do workspace (mesmo do dashboard). Schema `kommo`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { fetchAllRows } from "../_shared/paginate.ts";
import { authorizeWorkspace } from "../_shared/authorize.ts";
import { buildBucketResolver, parseFunnelMapping } from "../_shared/kommo-funnel.ts";
import { KommoReportSnapshotPayloadSchema, CustomMetricsListSchema } from "../_shared/schemas.ts";
import { corsHeadersExtended as corsHeaders } from "../_shared/cors.ts";

// Formato das linhas lidas de kommo.leads/lead_stage_events, só os campos usados aqui.
interface LeadRow {
  kommo_id: string;
  status: string;
  status_id: string | null;
  price: number | null;
  responsible_user_id: string | null;
  kommo_created_at: string | null;
  closed_at: string | null;
  pipeline_id: string | null;
}
interface StageEventRow {
  lead_id: string | null;
  pipeline_id: string | null;
  after_status_id: string | null;
}

// Ano-mês (YYYY-MM) em horário de Brasília.
const BRT_MONTH_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
});
function brtMonth(d: Date): string {
  // en-CA => "YYYY-MM" (sem dia porque só pedimos year+month)
  return BRT_MONTH_FMT.format(d); // ex.: "2026-07"
}
function monthKeyToDate(key: string): string {
  return `${key}-01`; // 1º dia do mês (date)
}
// Instante em que o mês `key` fecha = 1º dia do mês SEGUINTE (UTC).
function monthEndDate(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1));
}
// Dias de carência após o fechamento do mês (ou a conexão do workspace, o que
// for mais tarde) antes da foto travar de vez — dá espaço pro sync assentar
// (full-scan diário, correções de lead reaberto) antes de virar definitivo.
// Financeiro (data de fechamento) já nasce "decidido" quando o lead fecha, então
// só precisa de um respiro curto pro sync. Comercial (data de criação) mede uma
// SAFRA inteira — a maioria dos leads criados no mês ainda está em aberto pouco
// depois do mês fechar, então precisa de bem mais tempo pra maturar antes de
// congelar, senão a foto trava cedo demais e subestima a conversão pra sempre.
const LOCK_GRACE_DAYS_FECHAMENTO = 3;
const LOCK_GRACE_DAYS_CRIACAO = 60;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "kommo" } });

    const payload = KommoReportSnapshotPayloadSchema.parse(await req.json().catch(() => ({})));
    const workspaceId = payload.workspace_id;
    const months = payload.months;
    // "Forçar recálculo" (menu ⋯ do Relatório) — ver comentário perto do loop de
    // montagem de `rows`. O "Atualizar agora" comum e o cron nunca mandam isso.
    const forceUnlockActive = payload.force && !!payload.forceFrom && !!payload.forceTo;
    // Backfill cirúrgico: só existe pro eixo Comercial (customRates só é calculado
    // em "criacao" — ver `bump` abaixo), e só entra em ação em células JÁ TRAVADAS
    // (célula destravada recalcula tudo, incluindo a métrica nova, naturalmente).
    const backfillMetricIdSet = new Set(payload.backfillMetricIds || []);
    const backfillActive = backfillMetricIdSet.size > 0;

    // Auth: JWT válido + membership (usuário) OU segredo interno (cron). Ver
    // _shared/authorize.ts — request sem usuário e sem segredo é rejeitado.
    await authorizeWorkspace({ req, db, supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, workspaceId });

    // ===== Settings: mapeamento das 4 fases (ganho/perda) + Métricas Personalizadas =====
    const { data: settingsRow } = await db.from("dashboard_settings")
      .select("funnel_stage_mapping, custom_metrics").eq("workspace_id", workspaceId).maybeSingle();
    const settings = (settingsRow || {}) as Record<string, unknown>;

    // (funil, status_id) -> fase, a partir do mapeamento configurado. As chaves podem
    // vir como "<pipelineId>:<statusId>" (atual) ou "<statusId>" (legado, vale p/ todos
    // os funis) — ver _shared/kommo-funnel.ts. O par importa porque `142`/`143` são os
    // mesmos ids em todo funil do Kommo.
    const parsedMapping = parseFunnelMapping(settings?.funnel_stage_mapping as Record<string, unknown>);
    const statusBucket = buildBucketResolver(parsedMapping);
    // Ganho = status de sistema do Kommo (o 142) OU etapa mapeada como venda_ganha
    // NAQUELE funil. Independente das Métricas Personalizadas abaixo.
    const isWon = (l: LeadRow) => l.status === "won" || statusBucket(l.pipeline_id, l.status_id) === "venda_ganha";
    const isLost = (l: LeadRow) => l.status === "lost";

    // ===== Métricas Personalizadas visíveis no Relatório =====
    // Mesma configuração usada pelo Dashboard ao vivo (kommo-dashboard), mas
    // calculada aqui como COORTE MENSAL: numerador E denominador = "alcançou"
    // (histórico via lead_stage_events + status atual), nunca "está atualmente
    // em" — esse conceito não faz sentido pra uma foto de mês já fechado/travado.
    // Substitui as antigas "Taxas de fase" (4 fases fixas) por pares pipeline+
    // status livres, os mesmos que o usuário já configura em Configurações.
    const customMetricsParsed = CustomMetricsListSchema.safeParse(settings?.custom_metrics ?? []);
    const reportMetrics = (customMetricsParsed.success ? customMetricsParsed.data : [])
      .filter((m) => m.reportVisible !== false);
    const stageRefKey = (r: { pipelineId: string; statusId: string }) => `${r.pipelineId}:${r.statusId}`;
    const metricNumKeys = new Map<string, Set<string>>();
    const metricDenKeys = new Map<string, Set<string>>();
    for (const m of reportMetrics) {
      metricNumKeys.set(m.id, new Set(m.numerator.map(stageRefKey)));
      metricDenKeys.set(m.id, new Set(m.denominator.map(stageRefKey)));
    }

    // ===== Leads (TODOS os funis — o escopo por funil é resolvido na agregação) =====
    const leadsRows = await fetchAllRows((from, to) => db.from("leads")
      .select("kommo_id,status,status_id,price,responsible_user_id,kommo_created_at,closed_at,pipeline_id")
      .eq("workspace_id", workspaceId).eq("is_deleted", false).order("kommo_id").range(from, to));
    const leads = leadsRows as LeadRow[];

    // ===== Trava ("period lock"): âncora da carência + células já travadas =====
    // Âncora = quando o workspace entrou no VFlow (não recria em reconexões — ver
    // kommo-manage, workspace só é criado uma vez). Sem isso, uma conta com meses
    // "fechados" há anos no calendário travaria tudo instantaneamente no 1º cálculo,
    // sem o sync ter tido chance de assentar o histórico ainda.
    const { data: wsRow } = await db.from("workspaces").select("created_at").eq("id", workspaceId).maybeSingle();
    const workspaceCreatedAt = wsRow?.created_at ? new Date(wsRow.created_at) : new Date(0);
    // Células já travadas não são recalculadas nem regravadas — ver loop de montagem
    // de `rows` abaixo. supabase-js não suporta upsert com WHERE condicional, então o
    // jeito mais simples (sem precisar de função Postgres nova) é nunca colocar essas
    // células no array que vai pro upsert.
    const { data: lockedRows } = await db.from("report_snapshots")
      .select("pipeline_id, month, date_basis, metrics, locked_at, frozen_at, is_partial")
      .eq("workspace_id", workspaceId).eq("locked", true);
    const lockedKeys = new Set((lockedRows || []).map((r) => `${r.pipeline_id}|${r.date_basis}|${r.month}`));
    // Linha travada completa, por chave — usada só no caminho de backfill cirúrgico
    // (precisa do metrics/locked_at/frozen_at ORIGINAIS pra não perder o congelamento
    // dos campos que não são customRates).
    const lockedRowByKey = new Map((lockedRows || []).map((r) => [`${r.pipeline_id}|${r.date_basis}|${r.month}`, r]));
    // Merge não-destrutivo: troca só as entradas de `customRates` cujo id está em
    // `ids`, preservando as demais métricas (e as de bySeller) como estavam.
    const mergeCustomRates = (
      existing: { id: string }[] | undefined, fresh: { id: string }[] | undefined, ids: Set<string>,
    ) => {
      const freshMap = new Map((fresh || []).map((r) => [r.id, r]));
      const seen = new Set<string>();
      const out = (existing || []).map((r) => {
        seen.add(r.id);
        return ids.has(r.id) && freshMap.has(r.id) ? freshMap.get(r.id)! : r;
      });
      for (const [id, r] of freshMap) if (ids.has(id) && !seen.has(id)) out.push(r);
      return out;
    };

    // ===== "Alcançou etapa X" — histórico de eventos por lead, pares livres =====
    // Diferente das antigas 4 fases (que tinham ORDEM total, "alcançou até aqui"),
    // pares pipeline+status livres não têm ordem — é só "algum evento bateu nesse
    // conjunto de pares", igual countPassedThrough do Dashboard (kommo-dashboard/
    // pure.ts), mas comparando pelo pipeline do PRÓPRIO evento, não pelo pipeline
    // atual do lead (aqui trabalhamos com todos os funis de uma vez).
    const reachedKeysByLead = new Map<string, Set<string>>();
    if (reportMetrics.length) {
      const evRows = await fetchAllRows((from, to) => db.from("lead_stage_events")
        .select("lead_id,pipeline_id,after_status_id").eq("workspace_id", workspaceId).order("id").range(from, to));
      for (const e of (evRows || []) as StageEventRow[]) {
        if (!e.lead_id || !e.pipeline_id || !e.after_status_id) continue;
        const k = String(e.lead_id);
        let set = reachedKeysByLead.get(k); if (!set) { set = new Set(); reachedKeysByLead.set(k, set); }
        set.add(`${e.pipeline_id}:${e.after_status_id}`);
      }
    }
    // "Alcançou algum dos pares em `keys`": status atual bate OU tem evento histórico.
    const leadReachedAnyOf = (l: LeadRow, keys: Set<string> | undefined): boolean => {
      if (!keys || keys.size === 0) return false;
      const curKey = l.pipeline_id != null && l.status_id != null ? `${l.pipeline_id}:${l.status_id}` : null;
      if (curKey && keys.has(curKey)) return true;
      const hist = reachedKeysByLead.get(String(l.kommo_id));
      if (!hist) return false;
      for (const k of keys) if (hist.has(k)) return true;
      return false;
    };

    // ===== Janela de meses a gravar (últimos N + corrente), em BRT =====
    const nowMonthKey = brtMonth(new Date());
    // gera as chaves YYYY-MM dos últimos `months` meses + o corrente
    const monthKeys: string[] = [];
    {
      const [y, m] = nowMonthKey.split("-").map(Number);
      for (let i = months; i >= 0; i--) {
        const d = new Date(Date.UTC(y, m - 1 - i, 1));
        monthKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      }
    }
    const inRange = new Set(monthKeys);

    // ===== Agregação: funil × eixo × mês, com sub-bloco por vendedor =====
    type Acc = {
      leads: number; won: number; wonRevenue: number; lost: number; lostRevenue: number;
      cycleDaysSum: number; cycleDaysCount: number;
      customPassed: Record<string, number>; customBase: Record<string, number>;
    };
    const empty = (): Acc => ({
      leads: 0, won: 0, wonRevenue: 0, lost: 0, lostRevenue: 0,
      cycleDaysSum: 0, cycleDaysCount: 0, customPassed: {}, customBase: {},
    });
    const DAY_MS = 86_400_000;
    const bump = (a: Acc, l: LeadRow, axis: "criacao" | "fechamento") => {
      a.leads++;
      const price = Number(l.price) || 0;
      if (isWon(l)) { a.won++; a.wonRevenue += price; }
      else if (isLost(l)) { a.lost++; a.lostRevenue += price; }
      // Ciclo médio (criação → fechamento) só faz sentido pela safra de criação —
      // no eixo Financeiro cada mês já é o fechamento em si. Só vendas GANHAS (o
      // "tempo até perder" não é comparável ao "tempo até vender").
      if (axis === "criacao" && isWon(l) && l.kommo_created_at && l.closed_at) {
        const ms = new Date(l.closed_at).getTime() - new Date(l.kommo_created_at).getTime();
        if (ms >= 0) { a.cycleDaysSum += ms; a.cycleDaysCount++; }
      }
      // Métricas Personalizadas no Relatório só na safra por criação (mesma
      // amarração que as antigas Taxas de fase já tinham).
      if (axis === "criacao") {
        for (const m of reportMetrics) {
          if (leadReachedAnyOf(l, metricNumKeys.get(m.id))) a.customPassed[m.id] = (a.customPassed[m.id] || 0) + 1;
          if (m.format === "percent" && leadReachedAnyOf(l, metricDenKeys.get(m.id))) a.customBase[m.id] = (a.customBase[m.id] || 0) + 1;
        }
      }
    };

    const agg = new Map<string, Acc>();                 // `${pipeline}|${axis}|${month}`
    const sellerAgg = new Map<string, Acc>();           // `${pipeline}|${axis}|${month}|${seller}`
    const sellersByCell = new Map<string, Set<string>>(); // cell -> vendedores presentes
    const pipelinesSeen = new Set<string>();

    const record = (axis: "criacao" | "fechamento", month: string, l: LeadRow) => {
      if (!inRange.has(month)) return;
      const pid = l.pipeline_id ? String(l.pipeline_id) : "unknown";
      const sid = l.responsible_user_id ? String(l.responsible_user_id) : "__none__";
      pipelinesSeen.add(pid);
      for (const p of [pid, "__all__"]) {
        const ck = `${p}|${axis}|${month}`;
        let a = agg.get(ck); if (!a) { a = empty(); agg.set(ck, a); } bump(a, l, axis);
        const sk = `${ck}|${sid}`;
        let s = sellerAgg.get(sk); if (!s) { s = empty(); sellerAgg.set(sk, s); } bump(s, l, axis);
        let set = sellersByCell.get(ck); if (!set) { set = new Set(); sellersByCell.set(ck, set); } set.add(sid);
      }
    };

    for (const l of leads) {
      if (l.kommo_created_at) record("criacao", brtMonth(new Date(l.kommo_created_at)), l);
      if (l.closed_at) record("fechamento", brtMonth(new Date(l.closed_at)), l);
    }

    const buildMetrics = (a: Acc, axis: "criacao" | "fechamento") => {
      const closed = a.won + a.lost;
      const m: Record<string, unknown> = {
        leads: a.leads, won: a.won, wonRevenue: Math.round(a.wonRevenue),
        lost: a.lost, lostRevenue: Math.round(a.lostRevenue),
        ticket: a.won > 0 ? Math.round(a.wonRevenue / a.won) : 0,
        winRate: closed > 0 ? Math.round((a.won / closed) * 1000) / 10 : 0,
      };
      if (axis === "criacao") {
        m.cycleDays = a.cycleDaysCount > 0 ? Math.round((a.cycleDaysSum / a.cycleDaysCount / DAY_MS) * 10) / 10 : 0;
        m.cycleDaysSampleSize = a.cycleDaysCount;
      }
      if (axis === "criacao" && reportMetrics.length) {
        m.customRates = reportMetrics.map((cm) => ({
          id: cm.id, name: cm.name, format: cm.format,
          passed: a.customPassed[cm.id] || 0, base: a.customBase[cm.id] || 0,
        }));
      }
      return m;
    };

    // ===== Monta as linhas de upsert (uma por funil + '__all__') =====
    const frozenAt = new Date().toISOString();
    const now = new Date();
    let skippedLocked = 0;
    let forcedUnlocked = 0;
    let backfilled = 0;
    const rows: Record<string, unknown>[] = [];
    for (const p of ["__all__", ...pipelinesSeen]) {
      for (const axis of ["criacao", "fechamento"] as const) {
        for (const key of monthKeys) {
          const monthDate = monthKeyToDate(key);
          const cellKey = `${p}|${axis}|${monthDate}`;
          const isLocked = lockedKeys.has(cellKey);
          // "Forçar recálculo" (payload.force + forceFrom/forceTo): só ignora a trava
          // pros meses explicitamente pedidos — nunca pro "Atualizar agora" comum
          // nem pro cron, que nunca mandam esses campos (forceUnlockActive = false).
          const isForceUnlocked = forceUnlockActive && monthDate >= payload.forceFrom! && monthDate <= payload.forceTo!;
          // Backfill cirúrgico só se aplica ao eixo Comercial (onde customRates existe).
          const isBackfillTarget = backfillActive && axis === "criacao" && !isForceUnlocked;
          if (isLocked && !isForceUnlocked && !isBackfillTarget) { skippedLocked++; continue; }
          if (isLocked && isForceUnlocked) forcedUnlocked++;

          const ck = `${p}|${axis}|${key}`;
          const metrics = buildMetrics(agg.get(ck) || empty(), axis);
          const bySeller: Record<string, unknown> = {};
          for (const sid of sellersByCell.get(ck) || []) {
            const s = sellerAgg.get(`${ck}|${sid}`);
            if (s) bySeller[sid] = buildMetrics(s, axis);
          }
          metrics.bySeller = bySeller;

          // Célula travada + backfill pedido pra ela: NÃO recongela do zero. Só troca
          // as entradas de customRates das métricas pedidas, preservando leads/won/lost/
          // revenue/winRate/bySeller (e o customRates das demais métricas) exatamente
          // como estavam na foto original — é o que mantém a "essência congelada" do
          // resto da célula intacta.
          if (isLocked && isBackfillTarget) {
            const existing = lockedRowByKey.get(cellKey);
            if (!existing) { skippedLocked++; continue; } // trava sem linha gravada não deveria acontecer, mas não quebra
            const existingMetrics = (existing.metrics as Record<string, unknown>) || {};
            const existingBySeller = (existingMetrics.bySeller as Record<string, { customRates?: { id: string }[] }>) || {};
            const freshBySeller = bySeller as Record<string, { customRates?: { id: string }[] }>;
            const mergedBySeller: Record<string, unknown> = {};
            for (const sid of new Set([...Object.keys(existingBySeller), ...Object.keys(freshBySeller)])) {
              const exS = existingBySeller[sid] || {};
              const frS = freshBySeller[sid];
              mergedBySeller[sid] = frS
                ? { ...exS, customRates: mergeCustomRates(exS.customRates, frS.customRates, backfillMetricIdSet) }
                : exS;
            }
            rows.push({
              workspace_id: workspaceId, pipeline_id: p, month: monthDate, date_basis: axis,
              metrics: {
                ...existingMetrics,
                customRates: mergeCustomRates(
                  existingMetrics.customRates as { id: string }[] | undefined,
                  metrics.customRates as { id: string }[] | undefined,
                  backfillMetricIdSet,
                ),
                bySeller: mergedBySeller,
              },
              is_partial: existing.is_partial, frozen_at: existing.frozen_at, updated_at: frozenAt,
              locked: true, locked_at: existing.locked_at,
            });
            backfilled++;
            continue;
          }

          const isPartial = key === nowMonthKey;
          // Mês corrente nunca trava (ainda em andamento). Mês fechado trava depois
          // da carência, contada do que vier mais tarde: fechamento do mês ou conexão
          // do workspace — ver comentário acima de `workspaceCreatedAt`. Carência varia
          // por eixo — ver comentário de LOCK_GRACE_DAYS_CRIACAO.
          let locked = false;
          let lockedAt: string | null = null;
          if (!isPartial) {
            const graceDays = axis === "criacao" ? LOCK_GRACE_DAYS_CRIACAO : LOCK_GRACE_DAYS_FECHAMENTO;
            const graceStart = new Date(Math.max(monthEndDate(key).getTime(), workspaceCreatedAt.getTime()));
            const lockAt = new Date(graceStart.getTime() + graceDays * 86_400_000);
            if (now >= lockAt) { locked = true; lockedAt = now.toISOString(); }
          }

          rows.push({
            workspace_id: workspaceId, pipeline_id: p, month: monthDate,
            date_basis: axis, metrics, is_partial: isPartial, frozen_at: frozenAt, updated_at: frozenAt,
            locked, locked_at: lockedAt,
          });
        }
      }
    }

    // ===== Check de integridade (auditoria automática dos números gravados) =====
    // Roda sobre as próprias linhas recém-calculadas. Não bloqueia a gravação; só
    // reporta divergências pra quem disparou (toast no frontend) e nos logs.
    const quality: { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } = { ok: true, checks: [] };
    const addCheck = (name: string, ok: boolean, detail?: string) => {
      quality.checks.push({ name, ok, ...(detail ? { detail } : {}) });
      if (!ok) quality.ok = false;
    };
    const num = (m: unknown, k: string) => Number((m as Record<string, unknown> | undefined)?.[k]) || 0;
    // 1) won + lost nunca podem exceder o total de leads da célula.
    let overflow = 0;
    for (const r of rows) if (num(r.metrics, "won") + num(r.metrics, "lost") > num(r.metrics, "leads")) overflow++;
    addCheck("won+lost ≤ leads", overflow === 0, overflow ? `${overflow} célula(s) com ganho+perda > total` : undefined);
    // 2) '__all__' tem de ser a soma exata dos funis (mesmo eixo + mês), sem dupla contagem.
    let mismatch = 0;
    for (const axis of ["criacao", "fechamento"] as const) {
      for (const key of monthKeys) {
        const all = agg.get(`__all__|${axis}|${key}`);
        let soma = 0;
        for (const p of pipelinesSeen) soma += (agg.get(`${p}|${axis}|${key}`)?.leads ?? 0);
        if ((all?.leads ?? 0) !== soma) mismatch++;
      }
    }
    addCheck("__all__ = soma dos funis", mismatch === 0, mismatch ? `${mismatch} mês/eixo divergente(s)` : undefined);
    // 3) Soma dos sub-blocos bySeller bate com o total da célula — só leads/won/lost
    //    (inteiros, soma exata). wonRevenue/lostRevenue ficam de fora de propósito:
    //    são arredondadas independentemente em cada nível (célula e por vendedor),
    //    então a soma dos arredondados por vendedor diverge do arredondado da célula
    //    por ±1 em casos normais — incluir aqui geraria falso positivo constante.
    let sellerSumMismatch = 0;
    for (const r of rows) {
      const bySeller = (r.metrics as Record<string, unknown>).bySeller as Record<string, Record<string, unknown>> | undefined;
      if (!bySeller) continue;
      let leadsSum = 0, wonSum = 0, lostSum = 0;
      for (const s of Object.values(bySeller)) { leadsSum += num(s, "leads"); wonSum += num(s, "won"); lostSum += num(s, "lost"); }
      if (leadsSum !== num(r.metrics, "leads") || wonSum !== num(r.metrics, "won") || lostSum !== num(r.metrics, "lost")) sellerSumMismatch++;
    }
    addCheck("soma bySeller (leads/won/lost) = total da célula", sellerSumMismatch === 0,
      sellerSumMismatch ? `${sellerSumMismatch} célula(s) com soma por vendedor divergente` : undefined);
    // 4) Receita nunca deveria ser negativa (price negativo indicaria dado sujo no Kommo).
    let negativeRevenue = 0;
    for (const r of rows) if (num(r.metrics, "wonRevenue") < 0 || num(r.metrics, "lostRevenue") < 0) negativeRevenue++;
    addCheck("wonRevenue/lostRevenue ≥ 0", negativeRevenue === 0,
      negativeRevenue ? `${negativeRevenue} célula(s) com receita negativa` : undefined);

    // Upsert em lotes (evita payloads grandes com muitos funis).
    for (let i = 0; i < rows.length; i += 500) {
      const { error: upErr } = await db.from("report_snapshots")
        .upsert(rows.slice(i, i + 500), { onConflict: "workspace_id,pipeline_id,month,date_basis" });
      if (upErr) throw upErr;
    }

    if (!quality.ok) console.warn("kommo-report-snapshot integridade:", JSON.stringify(quality));

    return new Response(JSON.stringify({
      ok: true, workspace_id: workspaceId, months, rows: rows.length,
      pipelines: pipelinesSeen.size, monthKeys, leadsScanned: leads.length,
      frozenAt, quality, skippedLocked, forcedUnlocked, backfilled,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    // Body fora do formato esperado (ex.: sem workspace_id) → 400 com mensagem clara.
    if (err instanceof z.ZodError) {
      const msg = err.errors.map((e) => `${e.path.join(".") || "body"}: ${e.message}`).join("; ");
      console.error("kommo-report-snapshot payload inválido:", msg);
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const msg = err instanceof Error
      ? err.message
      : (err && typeof err === "object")
        ? JSON.stringify(err)
        : String(err);
    console.error("kommo-report-snapshot error:", msg);
    // Acesso negado → 403 (consistente com kommo-sync); demais falhas → 500.
    const status = msg === "Forbidden" || msg === "Missing authorization" ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
