// ai-assistant — Analista IA Fase 2 (chat). O gestor pergunta; a IA decide qual
// dado buscar (tool-calling de LEITURA), busca de verdade e responde com números
// reais. Escopo: os funis marcados no Analista (ai_insights_config.pipelines).
//
// Input: { workspace_id, thread_id?, question }
// Saída: { thread_id, answer }
// Auth: authenticated (admin ou membro do workspace). Não aceita anon/cron.
//
// Reusa _shared/dashboard-metrics (computePeriodMetrics), _shared/ai-provider e
// _shared/ai-usage. Mensagens persistidas em ai_assistant_threads/_messages.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { reportEdgeError } from "../_shared/error-reporter.ts";
import { resolveAiProvider } from "../_shared/ai-provider.ts";
import { logAiUsage } from "../_shared/ai-usage.ts";
import { computePeriodMetrics } from "../_shared/dashboard-metrics.ts";

const MAX_STEPS = 6;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_metrics",
      description: "Métricas de um período para os funis acompanhados: leads criados, ganhos, perdidos, valor, taxa de ganho por funil, estoque atual e envelhecimento, vendedores, e um rollup combinado (volume/valor). Chame mais de uma vez para comparar períodos.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Início do período em ISO (YYYY-MM-DD)." },
          end_date: { type: "string", description: "Fim do período em ISO (YYYY-MM-DD)." },
        },
        required: ["start_date", "end_date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_conversations",
      description: "Lista conversas recentes do workspace (nome do contato e id), opcionalmente filtrando por nome.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filtro por nome do contato (opcional)." },
          limit: { type: "number", description: "Máximo de conversas (padrão 10, teto 25)." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_conversation_messages",
      description: "Lê as últimas mensagens de uma conversa (conteúdo) para entender o que o lead falou.",
      parameters: {
        type: "object",
        properties: {
          ghl_conversation_id: { type: "string" },
          limit: { type: "number", description: "Máximo de mensagens (padrão 15, teto 40)." },
        },
        required: ["ghl_conversation_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_suggestions_stats",
      description: "Contagem das sugestões de CRM por status (pendente/aprovada/rejeitada) e por tipo.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

function todayBRT(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
    const question = (payload.question as string | undefined)?.trim();
    let threadId = payload.thread_id as string | undefined;
    if (!workspaceId || !question) throw new Error("workspace_id e question são obrigatórios");

    // --- Auth: authenticated (admin ou membro). Chat não é chamado por cron. ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace("Bearer ", "").trim();
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const [{ data: isAdmin }, { data: isMember }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      supabase.rpc("is_workspace_member", { _user_id: user.id, _workspace_id: workspaceId }),
    ]);
    if (!isAdmin && !isMember) throw new Error("Forbidden");

    // Workspace + owner (chaveia provider config)
    const { data: workspaceRow } = await supabase
      .from("workspaces").select("owner_id, deleted_at").eq("id", workspaceId).maybeSingle();
    if (!workspaceRow || workspaceRow.deleted_at) throw new Error("Workspace inválido");
    const ownerId = workspaceRow.owner_id as string;

    // Escopo: funis marcados no Analista
    const { data: settingsRow } = await supabase
      .from("ghl_dashboard_settings").select("ai_insights_config").eq("workspace_id", workspaceId).maybeSingle();
    const cfg = ((settingsRow?.ai_insights_config) || {}) as { pipelines?: Array<{ id: string }> };
    const pipelineIds = Array.isArray(cfg.pipelines) ? cfg.pipelines.filter((p) => p?.id).map((p) => p.id) : [];

    // Nomes dos funis em escopo (para o system prompt)
    let scopeNames: string[] = [];
    if (pipelineIds.length) {
      const { data: pipes } = await supabase
        .from("ghl_pipelines").select("ghl_id, name").eq("workspace_id", workspaceId).in("ghl_id", pipelineIds);
      scopeNames = ((pipes || []) as Array<any>).map((p) => p.name);
    }

    // --- Thread: cria se não veio (e valida posse se veio) ---
    if (threadId) {
      const { data: t } = await supabase
        .from("ai_assistant_threads").select("id, user_id").eq("id", threadId).maybeSingle();
      if (!t || (t.user_id !== user.id && !isAdmin)) throw new Error("Thread inválido");
    } else {
      const title = question.slice(0, 60);
      const { data: created, error: cErr } = await supabase
        .from("ai_assistant_threads")
        .insert({ workspace_id: workspaceId, user_id: user.id, title })
        .select("id").single();
      if (cErr) throw cErr;
      threadId = created.id as string;
    }

    // Histórico anterior do thread (para contexto)
    const { data: prior } = await supabase
      .from("ai_assistant_messages").select("role, content").eq("thread_id", threadId).order("created_at", { ascending: true }).limit(20);

    // Grava a pergunta do usuário
    await supabase.from("ai_assistant_messages").insert({ thread_id: threadId, role: "user", content: question });

    // --- Sem funis configurados: responde guiando, sem custo de IA ---
    if (pipelineIds.length === 0) {
      const answer = "O Analista ainda não tem funis configurados. Vá em Integrações → Analista IA, ligue e selecione os funis que devo acompanhar — aí eu consigo responder com os números.";
      await supabase.from("ai_assistant_messages").insert({ thread_id: threadId, role: "assistant", content: answer });
      return new Response(JSON.stringify({ success: true, data: { thread_id: threadId, answer } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Executor de tools (busca real no banco) ---
    const runTool = async (name: string, args: any): Promise<any> => {
      if (name === "get_metrics") {
        const startISO = new Date(`${args.start_date}T00:00:00-03:00`).toISOString();
        const endISO = new Date(`${args.end_date}T23:59:59-03:00`).toISOString();
        return await computePeriodMetrics(supabase, workspaceId, { startISO, endISO, pipelineIds });
      }
      if (name === "list_conversations") {
        const limit = Math.min(Math.max(Number(args.limit || 10), 1), 25);
        let q = supabase.from("ghl_conversations")
          .select("ghl_conversation_id, contact_name, last_message_at")
          .eq("workspace_id", workspaceId)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(limit);
        if (args.query) q = q.ilike("contact_name", `%${args.query}%`);
        const { data } = await q;
        return data || [];
      }
      if (name === "get_conversation_messages") {
        const limit = Math.min(Math.max(Number(args.limit || 15), 1), 40);
        const { data } = await supabase.from("ghl_messages")
          .select("direction, body, enriched_body, date_added")
          .eq("workspace_id", workspaceId)
          .eq("ghl_conversation_id", args.ghl_conversation_id)
          .order("date_added", { ascending: false })
          .limit(limit);
        return ((data || []) as Array<any>).reverse().map((m) => ({
          de: m.direction === "inbound" ? "lead" : "vendedor",
          texto: (m.enriched_body || m.body || "").slice(0, 400),
          em: m.date_added,
        }));
      }
      if (name === "get_suggestions_stats") {
        const { data } = await supabase.from("suggestions").select("status, type").eq("workspace_id", workspaceId);
        const out = { pending: 0, approved: 0, rejected: 0, by_type: {} as Record<string, number> };
        for (const s of (data || []) as Array<any>) {
          if (s.status === "pending") out.pending++;
          else if (s.status === "approved") out.approved++;
          else if (s.status === "rejected") out.rejected++;
          if (s.type) out.by_type[s.type] = (out.by_type[s.type] || 0) + 1;
        }
        return out;
      }
      return { error: "tool desconhecida" };
    };

    // --- System prompt ---
    const systemPrompt = `Você é o Analista IA do VFlow360, um assistente de análise comercial para o GESTOR. Hoje é ${todayBRT()} (America/Sao_Paulo).

Você NÃO sabe nada de cor: para responder qualquer número, USE AS TOOLS para buscar o dado real. Nunca invente números nem cite dados que não vieram de uma tool.

Funis que você acompanha (escopo): ${scopeNames.map((n) => `"${n}"`).join(", ")}. Só fale destes funis.

Regras:
- Analise CADA funil separadamente. NUNCA some funis diferentes para calcular conversão (cada um tem etapas/propósito próprios). Para visão geral, use só o rollup "combined" (volume/valor), nunca conversão misturada.
- Para comparar períodos, chame get_metrics uma vez por período.
- Responda em português do Brasil, objetivo, citando os números que sustentam a resposta.
- Se a pergunta não puder ser respondida com os dados disponíveis, diga isso com franqueza.`;

    // --- Loop de tool-calling ---
    const resolved = await resolveAiProvider(supabase, ownerId);
    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...((prior || []) as Array<any>).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: question },
    ];
    const usageAcc = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const toolsUsed: string[] = [];
    let answer = "";

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await fetch(resolved.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${resolved.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: resolved.model, messages, tools: TOOLS }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error("AI error:", res.status, t);
        if (res.status === 429) throw new Error("Limite de uso da IA atingido. Tente em instantes.");
        if (res.status === 401) throw new Error("Chave de IA inválida. Verifique as configurações.");
        throw new Error(`Falha na IA [${res.status}]`);
      }
      const data = await res.json();
      const u = data.usage || {};
      usageAcc.prompt_tokens += Number(u.prompt_tokens || 0);
      usageAcc.completion_tokens += Number(u.completion_tokens || 0);
      usageAcc.total_tokens += Number(u.total_tokens || 0);

      const msg = data.choices?.[0]?.message;
      messages.push(msg);
      const calls = msg?.tool_calls;
      if (calls && calls.length) {
        for (const tc of calls) {
          let args: any = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore */ }
          toolsUsed.push(tc.function.name);
          let result: any;
          try { result = await runTool(tc.function.name, args); }
          catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 12000) });
        }
        continue; // re-chama o modelo com os resultados
      }
      answer = msg?.content || "";
      break;
    }
    if (!answer) answer = "Não consegui concluir a análise agora. Pode reformular a pergunta?";

    await logAiUsage(supabase, { workspaceId, userId: ownerId, model: resolved.model, provider: resolved.providerLabel, usage: usageAcc });

    // Grava a resposta + toca updated_at do thread
    await supabase.from("ai_assistant_messages").insert({
      thread_id: threadId, role: "assistant", content: answer,
      refs: { tools_used: Array.from(new Set(toolsUsed)) },
      tokens: usageAcc.total_tokens,
    });
    await supabase.from("ai_assistant_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

    return new Response(JSON.stringify({ success: true, data: { thread_id: threadId, answer } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await reportEdgeError("edge:ai-assistant", e);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
