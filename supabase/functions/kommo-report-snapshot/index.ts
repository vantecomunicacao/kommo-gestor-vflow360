// VFlow360 Kommo — kommo-report-snapshot
// Calcula as FOTOS MENSAIS congeladas e grava em kommo.report_snapshots.
// Um único "recompute" cobre backfill + fechamento: agrupa os leads por mês (em
// horário de Brasília) nos dois eixos (criacao=kommo_created_at, fechamento=closed_at),
// e faz upsert. Mês-calendário corrente => is_partial=true; meses anteriores => congelados.
// Escopo do funil segue o default do workspace (mesmo do dashboard). Schema `kommo`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAllRows } from "../_shared/paginate.ts";
import { authorizeWorkspace } from "../_shared/authorize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "kommo" } });

    const payload = await req.json().catch(() => ({} as any));
    const workspaceId = payload.workspace_id as string;
    if (!workspaceId) throw new Error("workspace_id is required");
    const months: number = Number.isFinite(payload.months) ? Math.max(1, Math.min(36, payload.months)) : 12;

    // Auth: JWT válido + membership (usuário) OU segredo interno (cron). Ver
    // _shared/authorize.ts — request sem usuário e sem segredo é rejeitado.
    await authorizeWorkspace({ req, db, supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, workspaceId });

    // ===== Settings: mapeamento das 4 fases + fases-alvo das taxas =====
    const { data: settingsRow } = await db.from("dashboard_settings")
      .select("funnel_stage_mapping, funnel_stage_labels, report_rate_stages").eq("workspace_id", workspaceId).maybeSingle();
    const settings = (settingsRow || {}) as any;
    // report_rate_stages agora guarda CHAVES DE FASE (bucket), não ids de etapa do Kommo.
    const reportRateBuckets: string[] = Array.isArray(settings?.report_rate_stages) ? settings.report_rate_stages.map(String) : [];

    // Ordem e rótulos padrão das 4 fases do funil analítico.
    const BUCKET_ORDER: Record<string, number> = { contato_inicial: 0, proposta_enviada: 1, fechamento: 2, venda_ganha: 3 };
    const DEFAULT_LABEL: Record<string, string> = {
      contato_inicial: "Contato Inicial", proposta_enviada: "Proposta Enviada", fechamento: "Fechamento", venda_ganha: "Venda Ganha",
    };
    const funnelLabels = (settings?.funnel_stage_labels || {}) as Record<string, string>;

    // status_id -> fase (bucket), a partir do mapeamento configurado. Ganho => venda_ganha.
    const wonStatusIds = new Set<string>(["142"]);
    const statusBucket = new Map<string, string>();
    const rawMapping = (settings?.funnel_stage_mapping || {}) as Record<string, any>;
    for (const [stageId, bucket] of Object.entries(rawMapping)) {
      if (typeof bucket === "string" && bucket in BUCKET_ORDER) statusBucket.set(String(stageId), bucket);
      if (bucket === "venda_ganha") wonStatusIds.add(String(stageId));
    }
    statusBucket.set("142", "venda_ganha");
    const isWon = (l: any) => l.status === "won" || wonStatusIds.has(String(l.status_id));
    const isLost = (l: any) => l.status === "lost";

    // Alvos = fases escolhidas (subconjunto das 4), com ordem e rótulo (custom ou padrão).
    const targets = reportRateBuckets
      .filter((b) => b in BUCKET_ORDER)
      .map((b) => ({ id: b, label: funnelLabels[b] || DEFAULT_LABEL[b], order: BUCKET_ORDER[b] }));

    // ===== Leads (TODOS os funis — o escopo por funil é resolvido na agregação) =====
    const leadsRows = await fetchAllRows((from, to) => db.from("leads")
      .select("kommo_id,status,status_id,price,responsible_user_id,kommo_created_at,closed_at,pipeline_id")
      .eq("workspace_id", workspaceId).eq("is_deleted", false).order("kommo_id").range(from, to));
    const leads = leadsRows as any[];

    // ===== Taxas de fase ("chegou até a fase X") — cohort por data de criação =====
    // As 4 fases são a linguagem comum entre TODOS os funis, então isto funciona
    // corretamente inclusive no "Todos os funis". Reconstrói a fase mais avançada
    // alcançada por lead (fase atual + histórico de eventos; ganho alcança tudo).
    const maxBucketByLead = new Map<string, number>();
    if (targets.length) {
      const evRows = await fetchAllRows((from, to) => db.from("lead_stage_events")
        .select("lead_id,after_status_id").eq("workspace_id", workspaceId).order("id").range(from, to));
      for (const e of (evRows || []) as any[]) {
        const b = statusBucket.get(String(e.after_status_id));
        if (b == null || !e.lead_id) continue;
        const k = String(e.lead_id);
        maxBucketByLead.set(k, Math.max(maxBucketByLead.get(k) ?? -1, BUCKET_ORDER[b]));
      }
    }
    const reachedTargetIds = (l: any): string[] => {
      if (!targets.length) return [];
      if (isWon(l)) return targets.map((t) => t.id);
      const curB = statusBucket.get(String(l.status_id));
      let maxOrder = maxBucketByLead.get(String(l.kommo_id)) ?? -1;
      if (curB != null) maxOrder = Math.max(maxOrder, BUCKET_ORDER[curB]);
      return targets.filter((t) => maxOrder >= t.order).map((t) => t.id);
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
    type Acc = { leads: number; won: number; wonRevenue: number; lost: number; lostRevenue: number; reached: Record<string, number> };
    const empty = (): Acc => ({ leads: 0, won: 0, wonRevenue: 0, lost: 0, lostRevenue: 0, reached: {} });
    const bump = (a: Acc, l: any, axis: "criacao" | "fechamento") => {
      a.leads++;
      const price = Number(l.price) || 0;
      if (isWon(l)) { a.won++; a.wonRevenue += price; }
      else if (isLost(l)) { a.lost++; a.lostRevenue += price; }
      // Taxas de etapa só na safra por criação (denominador = criados).
      if (axis === "criacao") for (const id of reachedTargetIds(l)) a.reached[id] = (a.reached[id] || 0) + 1;
    };

    const agg = new Map<string, Acc>();                 // `${pipeline}|${axis}|${month}`
    const sellerAgg = new Map<string, Acc>();           // `${pipeline}|${axis}|${month}|${seller}`
    const sellersByCell = new Map<string, Set<string>>(); // cell -> vendedores presentes
    const pipelinesSeen = new Set<string>();

    const record = (axis: "criacao" | "fechamento", month: string, l: any) => {
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
      if (axis === "criacao" && targets.length) {
        m.reached = targets.map((t) => ({ id: t.id, label: t.label, count: a.reached[t.id] || 0 }));
      }
      return m;
    };

    // ===== Monta as linhas de upsert (uma por funil + '__all__') =====
    const frozenAt = new Date().toISOString();
    const rows: any[] = [];
    for (const p of ["__all__", ...pipelinesSeen]) {
      for (const axis of ["criacao", "fechamento"] as const) {
        for (const key of monthKeys) {
          const ck = `${p}|${axis}|${key}`;
          const metrics = buildMetrics(agg.get(ck) || empty(), axis);
          const bySeller: Record<string, unknown> = {};
          for (const sid of sellersByCell.get(ck) || []) {
            const s = sellerAgg.get(`${ck}|${sid}`);
            if (s) bySeller[sid] = buildMetrics(s, axis);
          }
          metrics.bySeller = bySeller;
          rows.push({
            workspace_id: workspaceId, pipeline_id: p, month: monthKeyToDate(key),
            date_basis: axis, metrics, is_partial: key === nowMonthKey, frozen_at: frozenAt, updated_at: frozenAt,
          });
        }
      }
    }

    // Upsert em lotes (evita payloads grandes com muitos funis).
    for (let i = 0; i < rows.length; i += 500) {
      const { error: upErr } = await db.from("report_snapshots")
        .upsert(rows.slice(i, i + 500), { onConflict: "workspace_id,pipeline_id,month,date_basis" });
      if (upErr) throw upErr;
    }

    return new Response(JSON.stringify({
      ok: true, workspace_id: workspaceId, months, rows: rows.length,
      pipelines: pipelinesSeen.size, monthKeys, leadsScanned: leads.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
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
