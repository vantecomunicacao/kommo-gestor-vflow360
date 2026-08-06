// VFlow360 Kommo — cooling-leads
// Calcula APENAS os "leads esfriando" (negócios abertos sem atividade há X dias),
// isolando esse dado sensível do dashboard do gestor. Schema `kommo`, isolado —
// NÃO toca em public.*/ghl_*.
//
// Atividade = última movimentação do lead (kommo_updated_at, fallback
// kommo_created_at). Fase 1 NÃO usa mensagens (o schema kommo não tem conversas);
// quando a Fase 2 trouxer ingestão de conversa, o "esfriamento" pode considerar a
// última mensagem trocada. Mesma regra do cooling embutido no kommo-dashboard.
// Faixas não-sobrepostas: 7–9 (warning) / 10–13 (alert) / 14+ (critical).
//
// Escopo: sempre "workspace". No Kommo não há login de vendedor (gestor-only), então
// o escopo-por-vendedor do mundo GHL (user_ghl_links) não se aplica. O campo `scope`
// é mantido para compatibilidade com o frontend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAllRows } from "../_shared/paginate.ts";
import { resolveCallerIdentity, requireWorkspaceMember } from "../_shared/authorize.ts";
import { corsHeadersExtended as corsHeaders } from "../_shared/cors.ts";

const DAY = 86_400_000;
const COOLING_THRESHOLDS = { warning: 7, alert: 10, critical: 14 };
const isWonName = (n: string) => /(ganho|ganha|won|venda)/.test((n || "").toLowerCase());

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    // Client com schema padrão `kommo`: todo .from() resolve em kommo.*
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "kommo" } });

    const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workspaceId = payload.workspace_id as string;
    if (!workspaceId) throw new Error("workspace_id is required");
    const filterPipelineIds: string[] = Array.isArray(payload.pipelineIds) ? payload.pipelineIds.filter(Boolean) : [];
    const filterSellerIds: string[] = Array.isArray(payload.sellerIds) ? payload.sellerIds.filter(Boolean) : [];

    // Auth: exige usuário válido no JWT + membership no workspace.
    const { userId } = await resolveCallerIdentity(req, SUPABASE_URL, ANON_KEY);
    if (!userId) throw new Error("Unauthorized");
    await requireWorkspaceMember(db, userId, workspaceId);

    // Stages "ganhas" para excluir do "aberto" (por nome + status_id 142 do Kommo).
    const [{ data: pipelinesRows }, { data: usersRows }] = await Promise.all([
      // Arquivado entra (lead antigo ainda referencia a etapa); apagado no Kommo, não.
      db.from("pipelines").select("kommo_id,name,statuses").eq("workspace_id", workspaceId).eq("is_deleted", false),
      db.from("users").select("kommo_id,name").eq("workspace_id", workspaceId),
    ]);

    const wonStageIds = new Set<string>(["142"]); // 142 = "Venda ganha" (status de sistema Kommo)
    const pipelineNameById = new Map<string, string>();
    // Nome da etapa por par "pipeline:status" — status_id se repete entre funis (ex.: 142/143
    // são os mesmos ids em todos os funis), então mapear só por status seria ambíguo.
    const stageNameByPipelineStatus = new Map<string, string>();
    for (const p of (pipelinesRows || []) as any[]) {
      pipelineNameById.set(String(p.kommo_id), p.name);
      const stages = Array.isArray(p.statuses) ? p.statuses : [];
      for (const s of stages) {
        if (isWonName(s.name)) wonStageIds.add(String(s.id));
        stageNameByPipelineStatus.set(`${p.kommo_id}:${s.id}`, s.name);
      }
    }

    const sellerNameById = new Map<string, string>();
    for (const u of (usersRows || []) as any[]) sellerNameById.set(u.kommo_id, u.name);

    // Anti-duplicidade: ações já registradas pelo vflow (kommo.lead_actions) e tarefas
    // abertas já sincronizadas (kommo.tasks). taskDone = criada por nós OU tarefa aberta;
    // tagDone = tag aplicada pelo vflow (tags não são sincronizadas).
    const [actionRows, openTaskRows] = await Promise.all([
      fetchAllRows((from, to) => db.from("lead_actions").select("lead_kommo_id,kind")
        .eq("workspace_id", workspaceId).order("id").range(from, to)),
      fetchAllRows((from, to) => db.from("tasks").select("lead_id")
        .eq("workspace_id", workspaceId).eq("is_completed", false).order("id").range(from, to)),
    ]);
    const taskDoneSet = new Set<string>();
    const tagDoneSet = new Set<string>();
    for (const a of (actionRows || []) as any[]) {
      if (a.kind === "task") taskDoneSet.add(String(a.lead_kommo_id));
      else if (a.kind === "tag") tagDoneSet.add(String(a.lead_kommo_id));
    }
    for (const t of (openTaskRows || []) as any[]) {
      if (t.lead_id) taskDoneSet.add(String(t.lead_id));
    }

    // Leads abertos (sem filtro de data; aplica funil/vendedor opcionais). Exclui deletados.
    // Paginado — PostgREST corta a resposta em 1000 linhas.
    const leadRows = await fetchAllRows((from, to) => {
      let q = db
        .from("leads")
        .select("kommo_id,name,status,status_id,responsible_user_id,pipeline_id,kommo_updated_at,kommo_created_at,price")
        .eq("workspace_id", workspaceId)
        .neq("is_deleted", true);
      if (filterPipelineIds.length === 1) q = q.eq("pipeline_id", filterPipelineIds[0]);
      else if (filterPipelineIds.length > 1) q = q.in("pipeline_id", filterPipelineIds);
      if (filterSellerIds.length === 1) q = q.eq("responsible_user_id", filterSellerIds[0]);
      else if (filterSellerIds.length > 1) q = q.in("responsible_user_id", filterSellerIds);
      return q.order("kommo_id").range(from, to);
    });

    const nowMs = Date.now();
    const isOpen = (l: any) => {
      const st = (l.status || "").toLowerCase();
      if (st === "lost" || st === "won") return false;
      if (l.status_id && wonStageIds.has(String(l.status_id))) return false;
      return true;
    };

    type CoolingLead = { name: string; seller: string | null; days: number; kommo_id: string; responsible_user_id: string | null; taskDone: boolean; tagDone: boolean; pipeline: string | null; stage: string | null };
    const result = {
      warning: 0, alert: 0, critical: 0, total: 0,
      revenue: { warning: 0, alert: 0, critical: 0, total: 0 },
      thresholds: COOLING_THRESHOLDS,
      leads: { warning: [] as CoolingLead[], alert: [] as CoolingLead[], critical: [] as CoolingLead[] },
      scope: "workspace" as const,
      // Opções pros filtros da tela (sempre a lista completa do workspace, não filtrada).
      pipelines: (pipelinesRows || []).map((p: any) => ({ id: String(p.kommo_id), name: p.name })),
      users: (usersRows || []).map((u: any) => ({ id: String(u.kommo_id), name: u.name })),
    };

    for (const l of (leadRows || [])) {
      if (!isOpen(l)) continue;
      const baseStr = (l as any).kommo_updated_at || (l as any).kommo_created_at;
      if (!baseStr) continue;
      const baseMs = new Date(baseStr).getTime();
      if (isNaN(baseMs)) continue;
      const days = (nowMs - baseMs) / DAY;
      if (days < COOLING_THRESHOLDS.warning) continue;
      result.total++;
      const bucket: "warning" | "alert" | "critical" =
        days >= COOLING_THRESHOLDS.critical ? "critical"
        : days >= COOLING_THRESHOLDS.alert ? "alert"
        : "warning";
      result[bucket]++;
      const price = Number((l as any).price) || 0;
      result.revenue[bucket] += price;
      result.revenue.total += price;
      result.leads[bucket].push({
        name: (l as any).name || `Lead ${String((l as any).kommo_id).slice(0, 6)}`,
        seller: (l as any).responsible_user_id ? (sellerNameById.get((l as any).responsible_user_id) || null) : null,
        days: Math.floor(days),
        kommo_id: String((l as any).kommo_id),
        responsible_user_id: (l as any).responsible_user_id ? String((l as any).responsible_user_id) : null,
        taskDone: taskDoneSet.has(String((l as any).kommo_id)),
        tagDone: tagDoneSet.has(String((l as any).kommo_id)),
        pipeline: (l as any).pipeline_id ? (pipelineNameById.get(String((l as any).pipeline_id)) || null) : null,
        stage: (l as any).pipeline_id && (l as any).status_id
          ? (stageNameByPipelineStatus.get(`${(l as any).pipeline_id}:${(l as any).status_id}`) || null)
          : null,
      });
    }
    for (const k of ["warning", "alert", "critical"] as const) {
      result.leads[k].sort((a, b) => b.days - a.days);
      if (result.leads[k].length > 100) result.leads[k] = result.leads[k].slice(0, 100);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("cooling-leads error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
