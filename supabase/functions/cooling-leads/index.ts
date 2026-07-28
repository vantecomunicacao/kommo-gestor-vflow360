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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const token = authHeader.replace("Bearer ", "");

    const payload = await req.json().catch(() => ({} as any));
    const workspaceId = payload.workspace_id as string;
    if (!workspaceId) throw new Error("workspace_id is required");
    const filterPipelineId: string | null = payload.pipelineId || null;

    // Auth: exige usuário válido no JWT + membership no workspace.
    // getClaims em try/catch (não derruba com 500 nas API keys novas), mas o
    // usuário é OBRIGATÓRIO — sem usuário, 401; sem membership, 403.
    let userId: string | null = null;
    try {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: claims } = await userClient.auth.getClaims(token);
      userId = claims?.claims?.sub ?? null;
    } catch { userId = null; }
    if (!userId) throw new Error("Unauthorized");
    const { data: isMember } = await db.rpc("is_workspace_member", {
      _user_id: userId, _workspace_id: workspaceId,
    });
    if (!isMember) throw new Error("Forbidden");

    // Stages "ganhas" para excluir do "aberto" (por nome + status_id 142 do Kommo).
    const [{ data: pipelinesRows }, { data: usersRows }] = await Promise.all([
      // Arquivado entra (lead antigo ainda referencia a etapa); apagado no Kommo, não.
      db.from("pipelines").select("kommo_id,statuses").eq("workspace_id", workspaceId).eq("is_deleted", false),
      db.from("users").select("kommo_id,name").eq("workspace_id", workspaceId),
    ]);

    const wonStageIds = new Set<string>(["142"]); // 142 = "Venda ganha" (status de sistema Kommo)
    for (const p of (pipelinesRows || []) as any[]) {
      const stages = Array.isArray(p.statuses) ? p.statuses : [];
      for (const s of stages) {
        if (isWonName(s.name)) wonStageIds.add(String(s.id));
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

    // Leads abertos (sem filtro de data; aplica pipeline opcional). Exclui deletados.
    // Paginado — PostgREST corta a resposta em 1000 linhas.
    const leadRows = await fetchAllRows((from, to) => {
      let q = db
        .from("leads")
        .select("kommo_id,name,status,status_id,responsible_user_id,kommo_updated_at,kommo_created_at")
        .eq("workspace_id", workspaceId)
        .neq("is_deleted", true);
      if (filterPipelineId) q = q.eq("pipeline_id", filterPipelineId);
      return q.order("kommo_id").range(from, to);
    });

    const nowMs = Date.now();
    const isOpen = (l: any) => {
      const st = (l.status || "").toLowerCase();
      if (st === "lost" || st === "won") return false;
      if (l.status_id && wonStageIds.has(String(l.status_id))) return false;
      return true;
    };

    type CoolingLead = { name: string; seller: string | null; days: number; kommo_id: string; responsible_user_id: string | null; taskDone: boolean; tagDone: boolean };
    const result = {
      warning: 0, alert: 0, critical: 0, total: 0,
      thresholds: COOLING_THRESHOLDS,
      leads: { warning: [] as CoolingLead[], alert: [] as CoolingLead[], critical: [] as CoolingLead[] },
      scope: "workspace" as const,
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
      result.leads[bucket].push({
        name: (l as any).name || `Lead ${String((l as any).kommo_id).slice(0, 6)}`,
        seller: (l as any).responsible_user_id ? (sellerNameById.get((l as any).responsible_user_id) || null) : null,
        days: Math.floor(days),
        kommo_id: String((l as any).kommo_id),
        responsible_user_id: (l as any).responsible_user_id ? String((l as any).responsible_user_id) : null,
        taskDone: taskDoneSet.has(String((l as any).kommo_id)),
        tagDone: tagDoneSet.has(String((l as any).kommo_id)),
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
