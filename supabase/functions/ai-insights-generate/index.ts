// ai-insights-generate — Analista IA (semanal). Analisa AO VIVO por periodo
// (sem snapshot): semana atual vs. semana anterior, lendo ghl_opportunities.
//
// Config por workspace em ghl_dashboard_settings.ai_insights_config:
//   { enabled, combined:{prompt}, pipelines:[{id,prompt}] }
//
// Faz UMA rodada de IA por funil marcado (cada um com seu prompt/foco) + UMA
// rodada da visao COMBINADA (volume/valor dos funis marcados, prompt proprio).
// prompt "" => usa o padrao embutido. Grava em ai_insights; loga custo.
//
// Trigger: cron ai-insights-tick (semanal) ou manual. Input: { workspace_id }.
// Auth: service role / anon (cron) / authenticated (admin/membro).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { reportEdgeError } from "../_shared/error-reporter.ts";
import { resolveAiProvider, aiProviderString } from "../_shared/ai-provider.ts";
import { logAiUsage } from "../_shared/ai-usage.ts";
import { computePeriodMetrics } from "../_shared/dashboard-metrics.ts";

const PROMPT_VERSION = "insights-v3-live-per-funnel";

const VALID_KINDS = ["gargalo", "tendencia", "oportunidade", "alerta"];
const VALID_SEVERITIES = ["info", "warn", "high"];

// Prompts padrao (foco). As REGRAS FIXAS ficam no system; aqui e so o foco que o
// gestor pode sobrescrever por funil / combinada.
const DEFAULT_FUNNEL_PROMPT =
  "Analise a saude deste funil: gargalos por etapa, taxa de ganho, leads parados (envelhecimento) e variacao vs. a semana anterior. Destaque o que precisa de acao.";
const DEFAULT_COMBINED_PROMPT =
  "De uma visao geral do volume do negocio somando os funis acompanhados: total de leads novos, valor ganho e em aberto, e variacao vs. a semana anterior. Foque em volume/receita, nunca em conversao misturada.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildSystemPrompt(scopeLabel: string, isCombined: boolean, customPrompt: string): string {
  return `Você é um analista comercial sênior do VFlow360. Gere INSIGHTS ACIONÁVEIS para o GESTOR.

ESCOPO DESTA ANÁLISE: ${scopeLabel}.

Regras fixas (NÃO podem ser quebradas pelo foco abaixo):
- Gere de 0 a 4 insights. Qualidade > quantidade. Nada relevante => lista vazia.
- Cada insight DEVE citar um dado concreto (número/variação). Nunca invente.
- ${isCombined
      ? "Esta é a VISÃO COMBINADA dos funis marcados: fale de VOLUME e VALOR agregados. NUNCA calcule ou cite uma 'conversão' somando funis diferentes — isso é proibido."
      : "Analise ESTE funil ISOLADAMENTE. Pode falar de taxa de ganho, gargalo por etapa e envelhecimento."}
- Quando houver dados da semana anterior, COMPARE (subiu/caiu) — é o insight mais valioso.
- "kind": um de ${VALID_KINDS.join(", ")}. "severity": info | warn | high.
- "title": curto (máx ~70 car.). "body": 1-3 frases, com a ação sugerida.
- Português do Brasil, objetivo e profissional.

FOCO definido pelo gestor para este escopo: ${customPrompt}`;
}

const emitInsightsTool = {
  type: "function",
  function: {
    name: "emit_insights",
    description: "Retorna a lista de insights analíticos para o gestor.",
    parameters: {
      type: "object",
      properties: {
        insights: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: VALID_KINDS },
              title: { type: "string" },
              body: { type: "string" },
              severity: { type: "string", enum: VALID_SEVERITIES },
              period_label: { type: "string", description: "Ex: 'vs. semana anterior'." },
            },
            required: ["kind", "title", "body", "severity"],
            additionalProperties: false,
          },
        },
      },
      required: ["insights"],
      additionalProperties: false,
    },
  },
};

async function callInsights(
  resolved: { endpoint: string; apiKey: string; model: string },
  system: string,
  user: string,
): Promise<{ insights: any[]; usage: any }> {
  const res = await fetch(resolved.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${resolved.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: resolved.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [emitInsightsTool],
      tool_choice: { type: "function", function: { name: "emit_insights" } },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("AI error:", res.status, errText);
    if (res.status === 429) throw new Error("Rate limit exceeded. Try again later.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please add funds.");
    if (res.status === 401) throw new Error("Invalid AI API key. Please check your settings.");
    throw new Error(`AI insights failed [${res.status}]`);
  }
  const data = await res.json();
  let insights: any[] = [];
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    try { insights = JSON.parse(toolCall.function.arguments).insights || []; }
    catch (e) { console.error("Failed to parse insights:", e); }
  }
  return { insights, usage: data.usage };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const payload = await req.json();
    const workspaceId = payload.workspace_id as string | undefined;
    if (!workspaceId) throw new Error("workspace_id is required");

    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace("Bearer ", "").trim();
    let isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
    let role = "unknown";
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        role = payloadJson?.role || "unknown";
        if (role === "service_role") isServiceRole = true;
      }
    } catch (_) { /* ignore */ }
    if (!isServiceRole) {
      if (role === "authenticated") {
        const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
        const { data: { user } } = await userClient.auth.getUser();
        if (!user) throw new Error("Unauthorized");
        const [{ data: isAdmin }, { data: isMember }] = await Promise.all([
          supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
          supabase.rpc("is_workspace_member", { _user_id: user.id, _workspace_id: workspaceId }),
        ]);
        if (!isAdmin && !isMember) throw new Error("Forbidden");
      } else if (role !== "anon") {
        throw new Error("Unauthorized");
      }
    }

    // Gate: workspace existe/nao deletado
    const { data: workspaceRow } = await supabase
      .from("workspaces").select("owner_id, deleted_at").eq("id", workspaceId).maybeSingle();
    if (!workspaceRow) throw new Error("Workspace nao encontrado");
    if (workspaceRow.deleted_at) {
      return new Response(JSON.stringify({ success: true, data: { skipped: true, reason: "workspace_deleted" } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const ownerId = workspaceRow.owner_id as string;

    // Config do Analista
    const { data: settingsRow } = await supabase
      .from("ghl_dashboard_settings").select("ai_insights_config").eq("workspace_id", workspaceId).maybeSingle();
    const cfg = ((settingsRow?.ai_insights_config) || {}) as {
      enabled?: boolean;
      combined?: { prompt?: string };
      pipelines?: Array<{ id: string; prompt?: string }>;
    };
    const selectedPipelines = Array.isArray(cfg.pipelines) ? cfg.pipelines.filter((p) => p && p.id) : [];
    if (!cfg.enabled || selectedPipelines.length === 0) {
      return new Response(JSON.stringify({ success: true, data: { skipped: true, reason: "analyst_disabled_or_no_pipeline" } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const pipelineIds = selectedPipelines.map((p) => p.id);

    // Janelas: semana atual (7d) vs anterior (7-14d)
    const now = new Date();
    const d = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
    const cur = await computePeriodMetrics(supabase, workspaceId, { startISO: d(7), endISO: now.toISOString(), pipelineIds });
    const prev = await computePeriodMetrics(supabase, workspaceId, { startISO: d(14), endISO: d(7), pipelineIds });

    // Lote desta execução + período (datas BRT) gravados em cada insight.
    const batchId = crypto.randomUUID();
    const brtDate = (iso: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    const periodStart = brtDate(d(7));
    const periodEnd = brtDate(now.toISOString());

    const resolved = await resolveAiProvider(supabase, ownerId);
    const versionStr = `${PROMPT_VERSION} (${aiProviderString(resolved)})`;
    const collected: any[] = [];
    let usageAcc = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const addUsage = (u: any) => {
      if (!u) return;
      usageAcc.prompt_tokens += Number(u.prompt_tokens || 0);
      usageAcc.completion_tokens += Number(u.completion_tokens || 0);
      usageAcc.total_tokens += Number(u.total_tokens || 0);
    };

    const cleanInto = (rawList: any[], scope: { pipeline_id: string | null; pipeline_name: string | null }) => {
      for (const i of rawList) {
        if (!i || !VALID_KINDS.includes(i.kind) || !i.title || !i.body) continue;
        if (collected.length >= 12) break; // teto de seguranca por execucao
        collected.push({
          workspace_id: workspaceId,
          kind: i.kind,
          title: String(i.title).slice(0, 200),
          body: String(i.body),
          severity: VALID_SEVERITIES.includes(i.severity) ? i.severity : "info",
          period_label: i.period_label ? String(i.period_label).slice(0, 80) : "vs. semana anterior",
          refs: { scope: scope.pipeline_id ? "pipeline" : "combined", pipeline_id: scope.pipeline_id, pipeline_name: scope.pipeline_name },
          status: "active",
          prompt_version: versionStr,
          batch_id: batchId,
          period_start: periodStart,
          period_end: periodEnd,
        });
      }
    };

    // 1) Uma rodada por funil marcado
    for (const sel of selectedPipelines) {
      const curP = cur.pipelines.find((p) => p.id === sel.id);
      if (!curP) continue;
      const prevP = prev.pipelines.find((p) => p.id === sel.id) || null;
      const focus = (sel.prompt && sel.prompt.trim()) ? sel.prompt.trim() : DEFAULT_FUNNEL_PROMPT;
      const system = buildSystemPrompt(`Funil "${curP.name}" (isolado)`, false, focus);
      const user = `MÉTRICAS DA SEMANA ATUAL — funil ${curP.name}:\n${JSON.stringify(curP, null, 2)}\n\n` +
        (prevP ? `SEMANA ANTERIOR — funil ${curP.name}:\n${JSON.stringify(prevP, null, 2)}` : "Não há semana anterior comparável.") +
        `\n\nGere os insights usando a tool fornecida.`;
      const { insights, usage } = await callInsights(resolved, system, user);
      addUsage(usage);
      cleanInto(insights, { pipeline_id: curP.id, pipeline_name: curP.name });
    }

    // 2) Visao combinada (volume/valor) + amostra de conversas recentes
    let conversationSample = "";
    try {
      const { data: convs } = await supabase
        .from("ghl_conversations")
        .select("ghl_conversation_id, contact_name")
        .eq("workspace_id", workspaceId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(6);
      const blocks: string[] = [];
      for (const c of ((convs || []) as Array<any>)) {
        const { data: msgs } = await supabase
          .from("ghl_messages")
          .select("direction, body, enriched_body, date_added")
          .eq("workspace_id", workspaceId)
          .eq("ghl_conversation_id", c.ghl_conversation_id)
          .order("date_added", { ascending: false })
          .limit(5);
        const lines = ((msgs || []) as Array<any>).reverse()
          .map((m) => `${m.direction === "inbound" ? "Lead" : "Vendedor"}: ${(m.enriched_body || m.body || "").slice(0, 240)}`)
          .filter((l) => l.length > 8);
        if (lines.length) blocks.push(`Conversa com ${c.contact_name || "lead"}:\n${lines.join("\n")}`);
      }
      conversationSample = blocks.join("\n\n---\n\n").slice(0, 4500);
    } catch (_) { /* best-effort */ }

    {
      const focus = (cfg.combined?.prompt && cfg.combined.prompt.trim()) ? cfg.combined.prompt.trim() : DEFAULT_COMBINED_PROMPT;
      const system = buildSystemPrompt("Visão combinada (todos os funis marcados — volume/valor)", true, focus);
      const user = `VOLUME COMBINADO — SEMANA ATUAL:\n${JSON.stringify(cur.combined, null, 2)}\n\n` +
        `VOLUME COMBINADO — SEMANA ANTERIOR:\n${JSON.stringify(prev.combined, null, 2)}\n\n` +
        `SUGESTÕES PENDENTES (estado atual): ${JSON.stringify(cur.suggestions)}\n\n` +
        `AMOSTRA DE CONVERSAS RECENTES:\n${conversationSample || "(sem amostra)"}\n\n` +
        `Gere os insights usando a tool fornecida.`;
      const { insights, usage } = await callInsights(resolved, system, user);
      addUsage(usage);
      cleanInto(insights, { pipeline_id: null, pipeline_name: null });
    }

    await logAiUsage(supabase, {
      workspaceId, userId: ownerId, model: resolved.model, provider: resolved.providerLabel, usage: usageAcc,
    });

    // Grava o novo lote. NÃO marca os anteriores como dismissed: o card mostra só
    // o lote mais recente (por batch_id), e dispensar/restaurar opera dentro do lote.
    if (collected.length > 0) {
      const { error: insErr } = await supabase.from("ai_insights").insert(collected);
      if (insErr) throw insErr;
      // Housekeeping: remove insights com mais de 60 dias (evita crescimento infinito).
      await supabase.from("ai_insights")
        .delete()
        .eq("workspace_id", workspaceId)
        .lt("created_at", new Date(Date.now() - 60 * 86400000).toISOString());
    }

    return new Response(JSON.stringify({ success: true, data: { generated: collected.length, funnels: pipelineIds.length } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await reportEdgeError("edge:ai-insights-generate", e);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
