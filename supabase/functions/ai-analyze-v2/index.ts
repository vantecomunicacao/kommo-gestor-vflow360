// Conversas 2.0 — analise de IA lendo o modelo GHL (ghl_conversations/ghl_messages).
//
// Clone do ai-analyze (1.0), com a CAMADA DE DADOS trocada:
//   - Input: { workspace_id, ghl_conversation_id }
//   - Mensagens: ghl_messages, conteudo = coalesce(enriched_body, body)
//   - Sugestoes: gravadas com ghl_conversation_id + workspace_id (nao conversation_id)
//   - Debounce: gerenciado em ghl_conversations (analyze_after/started/last_analyzed_at)
//
// Toda a logica de prompt/config/validacao/insert e identica ao 1.0 (mesmas
// tabelas ai_config, ai_provider_config, ghl_dashboard_settings, disabled_contacts,
// ghl_opportunities). resolvedUserId = owner do workspace (chaveia essas configs).
//
// Auth: service role / anon (cron via pg_net) / authenticated (admin ou membro).
// O ai-analyze 1.0 permanece intacto para o fluxo Evolution em producao.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { reportEdgeError } from "../_shared/error-reporter.ts";

// Versao do prompt/guardrails desta function. Gravada em suggestions.prompt_version
// para rastreabilidade (AI_DECISIONS #2). Bump SEMPRE que o system prompt OU os
// guardrails pos-LLM (normalizacao, dedup, contradicao) mudarem.
const PROMPT_VERSION = "suggest-v2-crm-actions-2026-06-07";

// ====== Helpers (identicos ao ai-analyze 1.0) ======
const VALID_SUGGESTION_TYPES = [
  "mover_funil",
  "campo_personalizado",
  "adicionar_nota",
  "valor_negociacao",
  "agendar_lembrete",
  "ganho_perdido",
];

const LEGACY_TYPE_MAP: Record<string, string> = {
  "🗓️ contato futuro": "agendar_lembrete",
  "field_personalizado": "campo_personalizado",
  "mov_funil": "mover_funil",
};

function normalizeSuggestionType(type: string): string | null {
  const normalized = LEGACY_TYPE_MAP[type.toLowerCase().trim()] || type;
  return VALID_SUGGESTION_TYPES.includes(normalized) ? normalized : null;
}

// Converte o "value" textual de uma sugestao de valor em numero (>0).
// Aceita "1500", "1500.00", "1500,50", "R$ 1.500,50". Retorna NaN se invalido.
function parseMonetaryValue(raw: unknown): number {
  if (raw == null) return NaN;
  let s = String(raw).replace(/[^\d.,]/g, "").trim();
  if (!s) return NaN;
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", "."); // "1.500,50" -> "1500.50"
  } else if (s.includes(",")) {
    s = s.replace(",", "."); // "1500,50" -> "1500.50"
  }
  return parseFloat(s);
}

// Valida due_date de agendar_lembrete: devolve a string original se for uma
// data ISO valida e no futuro; caso contrario null (a execucao aplica o
// default de 24h). Preserva o offset -03:00 que o executor espera.
function sanitizeFutureDate(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t) || t <= Date.now()) return null;
  return raw;
}

function resolveAiModel(
  providerConfig: { provider?: string; api_key?: string; model?: string } | null,
): { useOpenAI: boolean; model: string; providerLabel: string } {
  const useOpenAI = providerConfig?.provider === "openai" && !!providerConfig?.api_key;
  const model = useOpenAI ? (providerConfig?.model || "gpt-4o-mini") : "gpt-4o-mini";
  return { useOpenAI, model, providerLabel: "openai" };
}

function buildAiProviderString(
  _providerConfig: { model?: string } | null,
  resolved: { useOpenAI: boolean; model: string; providerLabel: string },
): string {
  return `openai/${resolved.model}`;
}
// ====== End helpers ======

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const payload = await req.json();
    const workspaceId = payload.workspace_id as string | undefined;
    const ghlConversationId = payload.ghl_conversation_id as string | undefined;
    if (!workspaceId || !ghlConversationId) {
      throw new Error("workspace_id and ghl_conversation_id are required");
    }

    // --- Auth: service role / anon (cron) / authenticated (admin ou membro) ---
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
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
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
      // anon -> aceita (cron interno)
    }

    // 1. Conversa (shim a partir de ghl_conversations)
    const { data: conversation } = await supabase
      .from("ghl_conversations")
      .select("id, contact_name, contact_phone, ghl_contact_id, ghl_location_id, analyze_after, analyze_started_at, last_analyzed_at")
      .eq("workspace_id", workspaceId)
      .eq("ghl_conversation_id", ghlConversationId)
      .maybeSingle();
    if (!conversation) throw new Error("Conversa nao encontrada em ghl_conversations");
    const ghlConvUuid = conversation.id as string;

    // Debounce guard: pula se uma mensagem mais nova empurrou analyze_after pro futuro
    if (conversation.analyze_after) {
      const analyzeAfterTime = new Date(conversation.analyze_after).getTime();
      if (analyzeAfterTime > Date.now()) {
        console.log(`Debounce: skipping ${ghlConversationId}, analyze_after in the future`);
        return new Response(JSON.stringify({ success: true, data: { suggestions: [], skipped: true, reason: "debounce" } }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 1a. Owner do workspace + gate de IA do workspace
    const { data: workspaceRow } = await supabase
      .from("workspaces")
      .select("owner_id, ai_analysis_enabled, deleted_at")
      .eq("id", workspaceId)
      .maybeSingle();
    if (!workspaceRow) throw new Error("Workspace nao encontrado");
    if (workspaceRow.deleted_at) {
      return new Response(JSON.stringify({ success: true, data: { suggestions: [], skipped: true, reason: "workspace_deleted" } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const resolvedUserId = workspaceRow.owner_id as string;
    if (!resolvedUserId) throw new Error("Workspace sem owner_id");

    if (!workspaceRow.ai_analysis_enabled) {
      await supabase
        .from("ghl_conversations")
        .update({ analyze_after: null, analyze_started_at: null })
        .eq("id", ghlConvUuid);
      return new Response(JSON.stringify({ success: true, data: { suggestions: [], skipped: true, reason: "workspace_ai_disabled" } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1b. Contato desabilitado para IA (por workspace)
    if (conversation.contact_phone) {
      const { data: disabledEntry } = await supabase
        .from("disabled_contacts")
        .select("id")
        .eq("user_id", resolvedUserId)
        .eq("workspace_id", workspaceId)
        .eq("contact_phone", conversation.contact_phone)
        .maybeSingle();
      if (disabledEntry) {
        await supabase.from("ghl_conversations").update({ analyze_after: null, analyze_started_at: null }).eq("id", ghlConvUuid);
        return new Response(JSON.stringify({ success: true, data: { suggestions: [], skipped: true, reason: "Contact AI analysis is disabled" } }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 1c. Filtro de pipeline — pula leads fora dos funis permitidos
    {
      const { data: dashSettings } = await supabase
        .from("ghl_dashboard_settings")
        .select("ai_allowed_pipeline_ids")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const allowedPipelines = (dashSettings?.ai_allowed_pipeline_ids as string[] | null) || [];
      if (allowedPipelines.length > 0) {
        const phone = conversation.contact_phone || "";
        const digits = phone.replace(/\D/g, "");
        const last10 = digits.slice(-10);

        const clearAndSkip = async (reason: string) => {
          await supabase.from("ghl_conversations").update({ analyze_after: null, analyze_started_at: null }).eq("id", ghlConvUuid);
          return new Response(JSON.stringify({ success: true, data: { suggestions: [], skipped: true, reason } }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        };

        if (!phone) return await clearAndSkip("no_contact_phone_for_pipeline_filter");

        let oppQuery = supabase
          .from("ghl_opportunities")
          .select("pipeline_id, ghl_updated_at")
          .eq("workspace_id", workspaceId)
          .order("ghl_updated_at", { ascending: false, nullsFirst: false })
          .limit(1);
        if (last10) oppQuery = oppQuery.or(`contact_phone.eq.${phone},contact_phone.ilike.%${last10}`);
        else oppQuery = oppQuery.eq("contact_phone", phone);

        const { data: opp } = await oppQuery.maybeSingle();
        if (!opp) return await clearAndSkip("no_opportunity_for_contact");
        if (!opp.pipeline_id || !allowedPipelines.includes(opp.pipeline_id)) {
          return await clearAndSkip("pipeline_not_allowed");
        }
      }
    }

    // 2. Mensagens (ghl_messages, conteudo = coalesce(enriched_body, body))
    const { data: messagesDesc, error: msgErr } = await supabase
      .from("ghl_messages")
      .select("body, enriched_body, direction, date_added")
      .eq("workspace_id", workspaceId)
      .eq("ghl_conversation_id", ghlConversationId)
      .order("date_added", { ascending: false })
      .limit(20);
    if (msgErr) throw new Error(`Error fetching messages: ${msgErr.message}`);
    const messages = (messagesDesc || [])
      .slice()
      .reverse()
      .map((m) => ({
        content: (m.enriched_body || m.body || "").trim(),
        direction: m.direction,
        created_at: m.date_added,
      }))
      .filter((m) => m.content.length > 0);

    if (messages.length === 0) {
      await supabase.from("ghl_conversations").update({ analyze_after: null, analyze_started_at: null, last_analyzed_at: new Date().toISOString() }).eq("id", ghlConvUuid);
      return new Response(JSON.stringify({ success: true, data: { suggestions: [] } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2a. Gate de idempotencia: se nada chegou desde a ultima analise, NAO chama
    // o LLM nem gera nada (reanalisar manualmente vira no-op). messagesDesc[0] e a
    // mensagem mais recente (query ordenada desc). Compara timestamp da mensagem
    // com last_analyzed_at; mensagem ja vista => date_added <= last_analyzed_at.
    const newestMsgAt = messagesDesc?.[0]?.date_added as string | null | undefined;
    if (conversation.last_analyzed_at && newestMsgAt &&
        new Date(newestMsgAt).getTime() <= new Date(conversation.last_analyzed_at).getTime()) {
      console.log(`Idempotente: nenhuma mensagem nova desde last_analyzed_at em ${ghlConversationId}`);
      return new Response(JSON.stringify({ success: true, data: { suggestions: [], skipped: true, reason: "no_new_messages" } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Integracao GHL do workspace (config: campos/etapas/prompt/credenciais)
    const { data: ghlIntegration } = await supabase
      .from("integrations")
      .select("config, status")
      .eq("workspace_id", workspaceId)
      .eq("type", "ghl")
      .maybeSingle();

    const ghlConfig = (ghlIntegration?.config || {}) as Record<string, any>;
    const selectedFields = ghlConfig.selectedFields || [];
    const selectedStages = ghlConfig.selectedStages || [];
    const aiPrompt = ghlConfig.aiPrompt || "";

    // 3b. Motivos de perda do GHL (para sugestoes ganho_perdido)
    let lostReasonsDescription = "";
    const lostReasonsMap: Record<string, string> = {};
    if (ghlIntegration?.status === "connected" && ghlConfig.apiKey) {
      try {
        const GHL_BASE = "https://services.leadconnectorhq.com";
        const lostReasonUrl = new URL("/opportunities/lost-reason", GHL_BASE);
        lostReasonUrl.searchParams.set("locationId", ghlConfig.locationId);
        const pResp = await fetch(lostReasonUrl.toString(), {
          headers: { Authorization: `Bearer ${ghlConfig.apiKey}`, "Content-Type": "application/json", Version: "2021-07-28" },
        });
        if (pResp.ok) {
          const pData = await pResp.json();
          const reasons: { id: string; name: string }[] = [];
          for (const reason of (pData?.lostReasons || [])) {
            const rId = reason.id || reason._id;
            reasons.push({ id: rId, name: reason.name });
            lostReasonsMap[rId] = reason.name;
          }
          if (reasons.length > 0) {
            lostReasonsDescription = `\n\nMotivos de perda disponíveis no CRM (para sugestões de "perdido", OBRIGATORIAMENTE escolha o motivo mais adequado usando o campo "lost_reason_id"):\n${reasons.map(r => `- ID: "${r.id}" → "${r.name}"`).join("\n")}`;
          }
        }
      } catch (e) {
        console.warn("Failed to fetch lost reasons:", e);
      }
    }

    // 4. AI config (quais acoes estao habilitadas)
    const { data: aiConfigs } = await supabase
      .from("ai_config")
      .select("action_type, enabled, auto_approve")
      .eq("user_id", resolvedUserId)
      .eq("workspace_id", workspaceId);

    const enabledActions = new Map<string, { enabled: boolean; autoApprove: boolean }>();
    const defaultActions = [
      "mover_funil", "campo_personalizado", "adicionar_nota",
      "valor_negociacao", "agendar_lembrete", "marcar_ganho", "marcar_perdido",
    ];
    for (const a of defaultActions) enabledActions.set(a, { enabled: true, autoApprove: false });
    if (aiConfigs) {
      for (const c of aiConfigs) enabledActions.set(c.action_type, { enabled: c.enabled, autoApprove: c.auto_approve });
    }

    const ganhoCfg = enabledActions.get("marcar_ganho") || { enabled: true, autoApprove: false };
    const perdidoCfg = enabledActions.get("marcar_perdido") || { enabled: true, autoApprove: false };
    enabledActions.set("ganho_perdido", { enabled: ganhoCfg.enabled || perdidoCfg.enabled, autoApprove: false });

    const activeActionTypes = [...enabledActions.entries()]
      .filter(([, v]) => v.enabled)
      .map(([k]) => k)
      .filter((k) => k !== "marcar_ganho" && k !== "marcar_perdido");

    if (activeActionTypes.length === 0) {
      await supabase.from("ghl_conversations").update({ analyze_after: null, analyze_started_at: null, last_analyzed_at: new Date().toISOString() }).eq("id", ghlConvUuid);
      return new Response(JSON.stringify({ success: true, data: { suggestions: [] } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const filteredActionTypes = activeActionTypes.filter((action) => {
      if (action === "mover_funil" && selectedStages.length === 0) return false;
      if (action === "campo_personalizado" && selectedFields.length === 0) return false;
      return true;
    });

    if (filteredActionTypes.length === 0) {
      await supabase.from("ghl_conversations").update({ analyze_after: null, analyze_started_at: null, last_analyzed_at: new Date().toISOString() }).eq("id", ghlConvUuid);
      return new Response(JSON.stringify({ success: true, data: { suggestions: [] } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. Sugestoes anteriores desta conversa (contexto)
    const { data: previousSuggestions } = await supabase
      .from("suggestions")
      .select("type, title, description, status, action_data, created_at")
      .eq("ghl_conversation_id", ghlConvUuid)
      .order("created_at", { ascending: false })
      .limit(30);

    let previousContext = "";
    if (previousSuggestions && previousSuggestions.length > 0) {
      const prevTexts = previousSuggestions.map((s) => {
        const actionData = s.action_data as Record<string, any> || {};
        return `- [${s.status.toUpperCase()}] ${s.type}: "${s.title}" (campo: ${actionData.field || "N/A"}, valor: ${actionData.value || "N/A"})`;
      });
      previousContext = `\n\nSUGESTÕES JÁ GERADAS ANTERIORMENTE PARA ESTE CONTATO (NÃO repita estas):
${prevTexts.join("\n")}

REGRAS SOBRE SUGESTÕES ANTERIORES:
- NÃO gere sugestões que já existem acima (mesmo tipo + mesmo campo + mesmo valor)
- NÃO contradiga sugestões já aprovadas (ex: se já foi aprovado "ganho", não sugira "perdido")
- Se já existe uma sugestão pendente para o mesmo campo, NÃO gere outra para o mesmo campo
- Analise o CONTEXTO COMPLETO da conversa antes de decidir. Se há ambiguidade, NÃO sugira.`;
    }

    // 6. Texto da conversa
    const conversationText = messages
      .map((m) => `[${m.direction === "inbound" ? "Lead" : "Atendente"}]: ${m.content}`)
      .join("\n");

    // 7. System prompt (identico ao 1.0)
    const fieldsDescription = selectedFields.length > 0
      ? `\n\nCampos do CRM disponíveis para atualização (APENAS estes campos podem ser sugeridos):\n${selectedFields
          .map((f: any) => {
            let desc = `- ${f.name} (chave: ${f.fieldKey}, tipo: ${f.dataType})`;
            if (f.description) desc += `: ${f.description}`;
            if (f.options && f.options.length > 0) {
              const optionsWithInstructions = f.options.map((opt: any) => {
                const val = typeof opt === "string" ? opt : opt.value;
                const instr = typeof opt === "object" && opt.instruction ? opt.instruction : "";
                return instr ? `"${val}" → ${instr}` : `"${val}"`;
              });
              desc += `\n  OPÇÕES VÁLIDAS (use APENAS estas):\n${optionsWithInstructions.map((o: string) => `    • ${o}`).join("\n")}`;
            }
            return desc;
          })
          .join("\n")}`
      : "";

    const stageNames = selectedStages.map((s: any) => s.name);
    const stagesDescription = selectedStages.length > 0
      ? `\n\nEtapas do funil disponíveis (APENAS estas podem ser sugeridas):\n${selectedStages
          .map((s: any) => `- "${s.name}" — stage_id: ${s.id} (funil: "${s.pipelineName}")${s.description ? `: ${s.description}` : ""}`)
          .join("\n")}\n\nATENÇÃO: Cada etapa pertence a um pipeline específico. Para mover_funil, retorne o campo "stage_id" com o ID EXATO da etapa destino (isso desambigua etapas de mesmo nome em funis diferentes) e use o nome da etapa no campo "value". Pipelines de "vendas" são para conversas comerciais; de "organização interna", para conversas internas.`
      : "";

    const actionTypesDescription = `\n\nTipos de ação que você pode sugerir:
${filteredActionTypes.includes("mover_funil") ? "- mover_funil: Sugerir mover o lead para outra etapa do funil" : ""}
${filteredActionTypes.includes("campo_personalizado") ? "- campo_personalizado: Sugerir preencher/atualizar um campo personalizado" : ""}
${filteredActionTypes.includes("adicionar_nota") ? "- adicionar_nota: Sugerir adicionar uma nota no contato" : ""}
${filteredActionTypes.includes("valor_negociacao") ? "- valor_negociacao: Sugerir atualizar o valor monetário da oportunidade/negociação no CRM. Use ESTE tipo SOMENTE quando houver uma QUANTIA CONCRETA na conversa (ex: 'R$ 5.000', '10x de 300', 'fechamos por 2 mil'). Se o lead apenas PEDIU preços, falou de orçamento ou mencionou o ASSUNTO valor sem citar um número, NÃO gere esta sugestão. NUNCA sugira valor 0, vazio ou estimado por você. Quando usar, NÃO use campo_personalizado para valores monetários. O campo 'value' deve conter APENAS o número (ex: '1500' ou '1500.00'), sem 'R$' ou texto. IMPORTANTE: sempre use o VALOR TOTAL/CHEIO da negociação, NUNCA o valor da parcela. Se a conversa mencionar parcelamento (ex: '10x de R$150', '12 vezes de 200', 'entrada de 500 + 6x de 300'), CALCULE e sugira o valor total (ex: 10x150=1500, 12x200=2400, 500+6*300=2300). Se houver desconto à vista mencionado, prefira o valor cheio negociado, não o à vista — a menos que o lead confirme pagamento à vista." : ""}
${filteredActionTypes.includes("agendar_lembrete") ? `- agendar_lembrete: Criar uma TAREFA no CRM com data de vencimento. Use 'task_title' para o título (ex: 'Retornar ligação', 'Enviar proposta') e 'due_date' no formato ISO 8601 com offset -03:00 (ex: '${new Date(Date.now() + 24*60*60*1000).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T")}-03:00'). A data DEVE estar no fuso UTC-03 (horário de Brasília) e SEMPRE no futuro relativo à data atual informada acima. NUNCA use anos passados. Se a mensagem mencionar uma data/hora específica, use essa (sempre no futuro). Caso contrário, defina para 24 horas a partir de agora. O título deve refletir a ação mencionada na conversa ou 'Entrar em contato' como padrão.` : ""}
${filteredActionTypes.includes("ganho_perdido") ? (() => {
  const allowWon = ganhoCfg.enabled;
  const allowLost = perdidoCfg.enabled;
  let directions = "";
  if (allowWon && allowLost) directions = `Sugerir marcar oportunidade como ganha ou perdida. Para "perdido", é OBRIGATÓRIO incluir o campo "lost_reason_id" com o ID exato de um dos motivos de perda listados abaixo.`;
  else if (allowWon) directions = `Sugerir marcar oportunidade APENAS como ganha (status "ganho"). NUNCA sugira "perdido" — esse tipo está desativado.`;
  else if (allowLost) directions = `Sugerir marcar oportunidade APENAS como perdida (status "perdido"). NUNCA sugira "ganho" — esse tipo está desativado. É OBRIGATÓRIO incluir o campo "lost_reason_id" com o ID exato de um dos motivos de perda listados abaixo.`;
  return `- ganho_perdido: ${directions} Analise o contexto da conversa para escolher o motivo mais adequado.${allowLost ? lostReasonsDescription : ""}`;
})() : ""}`.replace(/\n\n+/g, "\n");

    const validFieldKeys = new Set(selectedFields.map((f: any) => f.fieldKey));
    const validStageNames = new Set(stageNames);

    // Mapas para desambiguar etapa por stage_id e validar opcoes de campo.
    const stageIds: string[] = selectedStages.map((s: any) => s.id);
    const stageById = new Map<string, any>(selectedStages.map((s: any) => [s.id, s]));
    const stagesByName = new Map<string, any[]>();
    for (const s of selectedStages) {
      const k = (s.name || "").toLowerCase();
      const arr = stagesByName.get(k);
      if (arr) arr.push(s);
      else stagesByName.set(k, [s]);
    }
    // fieldKey -> conjunto de opcoes validas (so campos com opcoes definidas).
    const fieldOptionsByKey = new Map<string, Set<string>>();
    for (const f of selectedFields) {
      if (Array.isArray(f.options) && f.options.length > 0) {
        const vals = new Set<string>();
        for (const opt of f.options) {
          const v = typeof opt === "string" ? opt : opt?.value;
          if (v) vals.add(String(v));
        }
        if (vals.size > 0) fieldOptionsByKey.set(f.fieldKey, vals);
      }
    }

    const nowBrazil = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const systemPrompt = `Você é um assistente de CRM inteligente. Analise a conversa de WhatsApp abaixo e gere sugestões de ações para o CRM (Go High Level).

DATA E HORA ATUAL (referência obrigatória, fuso UTC-03 / America/Sao_Paulo): ${nowBrazil}
Qualquer data sugerida (como vencimento de tarefa) DEVE ser igual ou posterior a esta data. NUNCA use anos no passado.

${aiPrompt}
${fieldsDescription}
${stagesDescription}
${actionTypesDescription}
${previousContext}

Contato: ${conversation.contact_name || "Desconhecido"} (${conversation.contact_phone || ""})

REGRAS OBRIGATÓRIAS:
- Gere APENAS sugestões baseadas em evidências claras na conversa
- Cada sugestão deve ter um trecho da conversa que justifica a ação
- Não invente informações que não estão na conversa
- Seja conservador: na dúvida, não sugira
- Para "mover_funil": use EXATAMENTE um dos nomes de etapa listados acima. NUNCA invente nomes de etapas.
- Para "campo_personalizado": use APENAS campos listados acima (pela fieldKey). NUNCA sugira campos que não estão na lista.
- Se o campo tem OPÇÕES VÁLIDAS listadas, use APENAS um valor dessa lista. NUNCA invente opções.
- No campo "field" da sugestão, use a CHAVE do campo (fieldKey), não o nome amigável.
- No campo "value", use o valor exato (nome da etapa para funil, opção para dropdowns, texto para campos livres).
- Para "valor_negociacao": use SOMENTE quando houver uma QUANTIA CONCRETA citada na conversa. Se o lead apenas pediu preços ou falou de orçamento sem número, NÃO sugira. NUNCA invente, estime ou sugira valor 0/vazio. NÃO coloque valores monetários em campos personalizados. O "value" deve ser APENAS o número (ex: "1500", "2300.50"), sem "R$", sem texto. SEMPRE use o VALOR TOTAL/CHEIO da negociação — se houver parcelamento (ex: "10x de R$150"), multiplique para obter o total (1500). NUNCA sugira o valor da parcela isolada.
- NUNCA gere sugestões contraditórias no mesmo lote (ex: ganho E perdido ao mesmo tempo)
- Analise a conversa INTEIRA para entender a conclusão final do lead antes de sugerir ganho/perdido
- Retorne as sugestões usando a tool fornecida`;

    // 7b. Provider config do owner
    const { data: providerConfig } = await supabase
      .from("ai_provider_config")
      .select("provider, api_key, model")
      .eq("user_id", resolvedUserId)
      .maybeSingle();

    const resolved = resolveAiModel(providerConfig || null);
    const aiEndpoint = "https://api.openai.com/v1/chat/completions";
    const aiApiKey = resolved.useOpenAI ? providerConfig!.api_key : "";
    if (!aiApiKey) throw new Error("Nenhuma chave de IA configurada para esta conta. Configure sua chave de OpenAI em Configurações › IA.");

    console.log(`[v2] OpenAI (user key), model: ${resolved.model}`);

    // 8. Chamada de IA (tool calling)
    const aiRequestBody: any = {
      model: resolved.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analise esta conversa e gere sugestões de ações para o CRM:\n\n${conversationText}` },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "suggest_crm_actions",
            description: "Retorna sugestões de ações para o CRM baseadas na análise da conversa.",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", enum: filteredActionTypes, description: "Tipo da ação sugerida" },
                      title: { type: "string", description: "Título curto da sugestão (ex: 'Mover para Qualificado')" },
                      description: { type: "string", description: "Justificativa detalhada com trecho da conversa" },
                      field: { type: "string", description: "Para mover_funil: nome EXATO da etapa destino. Para campo_personalizado: a chave do campo (fieldKey). Para outros: campo relevante ou null." },
                      stage_id: { type: "string", description: "Apenas para mover_funil: o stage_id EXATO da etapa destino (das listadas). Use para desambiguar etapas de mesmo nome em funis diferentes.", ...(stageIds.length > 0 ? { enum: stageIds } : {}) },
                      value: {
                        type: "string",
                        description: stageNames.length > 0
                          ? `Para mover_funil: DEVE ser um destes valores exatos: ${stageNames.map((n: string) => `"${n}"`).join(", ")}. Para campo_personalizado com opções: use apenas valores da lista de opções válidas. Para outros: valor livre.`
                          : "Valor sugerido para o campo ou nome da etapa destino",
                      },
                      task_title: { type: "string", description: "Apenas para agendar_lembrete: título da tarefa. Padrão: 'Entrar em contato'." },
                      due_date: { type: "string", description: "Apenas para agendar_lembrete: data/hora de vencimento em ISO 8601 com offset -03:00. DEVE ser sempre no futuro. Se não mencionada, omitir." },
                      lost_reason_id: { type: "string", description: "OBRIGATÓRIO para ganho_perdido com valor 'perdido': ID exato do motivo de perda escolhido." },
                    },
                    required: ["type", "title", "description"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "suggest_crm_actions" } },
    };

    const aiResponse = await fetch(aiEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      if (aiResponse.status === 429) throw new Error("Rate limit exceeded. Try again later.");
      if (aiResponse.status === 402) throw new Error("AI credits exhausted. Please add funds.");
      if (aiResponse.status === 401) throw new Error("Invalid AI API key. Please check your settings.");
      throw new Error(`AI analysis failed [${aiResponse.status}]`);
    }

    const aiData = await aiResponse.json();

    // Log de uso/custo
    try {
      const usage = aiData.usage || {};
      const promptTokens = Number(usage.prompt_tokens || 0);
      const completionTokens = Number(usage.completion_tokens || 0);
      const totalTokens = Number(usage.total_tokens || promptTokens + completionTokens);
      const PRICING: Record<string, { in: number; out: number }> = {
        "gpt-4o": { in: 2.5, out: 10 },
        "gpt-4o-mini": { in: 0.15, out: 0.6 },
        "gpt-4-turbo": { in: 10, out: 30 },
        "gpt-3.5-turbo": { in: 0.5, out: 1.5 },
      };
      const pr = PRICING[resolved.model] || { in: 0, out: 0 };
      const costUsd = (promptTokens * pr.in + completionTokens * pr.out) / 1_000_000;
      await supabase.from("ai_usage_log").insert({
        workspace_id: workspaceId,
        user_id: resolvedUserId,
        conversation_id: null,
        provider: resolved.providerLabel,
        model: resolved.model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost_usd: Number(costUsd.toFixed(6)),
      });
    } catch (e) {
      console.error("Failed to log AI usage:", e);
    }

    // Parse tool call
    let suggestions: any[] = [];
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        suggestions = (JSON.parse(toolCall.function.arguments).suggestions) || [];
      } catch (e) {
        console.error("Failed to parse AI suggestions:", e);
      }
    }

    // 8b. Normaliza tipos
    suggestions = suggestions
      .map((s) => {
        const normalized = normalizeSuggestionType(s.type);
        if (!normalized) return null;
        return { ...s, type: normalized };
      })
      .filter(Boolean);

    // 9a. Filtra campos/etapas nao configurados
    suggestions = suggestions.filter((s) => {
      if (s.type === "mover_funil") {
        // Resolve a etapa canonica: 1o por stage_id (desambigua); senao por nome
        // EXATO, mas apenas se o nome nao for ambiguo entre os funis configurados.
        let stage = s.stage_id ? stageById.get(s.stage_id) : null;
        if (!stage) {
          const byName = stagesByName.get((s.value || s.field || "").toLowerCase());
          if (byName && byName.length === 1) stage = byName[0];
        }
        if (!stage) {
          console.log(`Filtered mover_funil: etapa nao resolvida (stage_id=${s.stage_id}, value=${s.value})`);
          return false;
        }
        s.__stage = stage;
      }
      if (s.type === "campo_personalizado") {
        if (!s.field || !validFieldKeys.has(s.field)) return false;
        const opts = fieldOptionsByKey.get(s.field);
        if (opts && !opts.has(String(s.value ?? ""))) {
          console.log(`Filtered campo_personalizado: valor "${s.value}" fora das opcoes de ${s.field}`);
          return false;
        }
      }
      if (s.type === "valor_negociacao") {
        const num = parseMonetaryValue(s.value);
        if (!Number.isFinite(num) || num <= 0) {
          console.log(`Filtered out valor_negociacao with invalid value: ${s.value}`);
          return false;
        }
      }
      return true;
    });

    // 9b. Contradicoes no mesmo lote
    const hasGanho = suggestions.some((s) => s.type === "ganho_perdido" && s.value?.toLowerCase()?.includes("ganh"));
    const hasPerdido = suggestions.some((s) => s.type === "ganho_perdido" && s.value?.toLowerCase()?.includes("perd"));
    if (hasGanho && hasPerdido) {
      suggestions = suggestions.filter((s) => s.type !== "ganho_perdido");
    }

    // 9c/9d. Contradicoes/duplicatas vs anteriores
    if (previousSuggestions && previousSuggestions.length > 0) {
      const approvedTypes = new Map<string, string>();
      for (const prev of previousSuggestions) {
        if (prev.status === "approved") {
          const prevData = prev.action_data as Record<string, any> || {};
          approvedTypes.set(`${prev.type}:${prevData.field || ""}`, prevData.value || "");
        }
      }
      suggestions = suggestions.filter((s) => {
        const key = `${s.type}:${s.field || ""}`;
        const prevValue = approvedTypes.get(key);
        if (prevValue !== undefined && prevValue !== s.value) return false;
        return true;
      });

      const existingKeys = new Set(
        previousSuggestions.map((prev) => {
          const prevData = prev.action_data as Record<string, any> || {};
          return `${prev.type}:${prevData.field || ""}:${prevData.value || ""}`;
        })
      );

      const normalizeTitle = (title: unknown): string => {
        if (typeof title !== "string" || !title) return "";
        const stopWords = new Set(["de", "do", "da", "dos", "das", "para", "por", "com", "sem", "em", "no", "na", "nos", "nas", "um", "uma", "que", "se", "ou", "ao", "os", "as", "este", "esta", "esse", "essa", "são", "está", "foi", "ser"]);
        return title.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter(w => w.length >= 3 && !stopWords.has(w))
          .sort()
          .join(" ");
      };
      const titlesSimilar = (a: string, b: string): boolean => {
        const wordsA = new Set(a.split(" "));
        const wordsB = new Set(b.split(" "));
        if (wordsA.size === 0 || wordsB.size === 0) return false;
        const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
        const minSize = Math.min(wordsA.size, wordsB.size);
        return intersection / minSize >= 0.6;
      };
      const existingNormTitles = previousSuggestions.map((prev) => ({ type: prev.type, norm: normalizeTitle(prev.title) }));

      suggestions = suggestions.filter((s) => {
        const key = `${s.type}:${s.field || ""}:${s.value || ""}`;
        if (existingKeys.has(key)) return false;
        const normTitle = normalizeTitle(s.title);
        const hasSimilar = existingNormTitles.some((prev) => prev.type === s.type && titlesSimilar(normTitle, prev.norm));
        if (hasSimilar) return false;
        return true;
      });
    }

    // 10. Salva sugestoes
    const insertedSuggestions = [];
    for (const s of suggestions) {
      let effectiveCfg = enabledActions.get(s.type);
      if (s.type === "ganho_perdido") {
        const isWon = (s.value || "").toLowerCase().includes("ganh");
        effectiveCfg = isWon ? ganhoCfg : perdidoCfg;
        if (!effectiveCfg.enabled) continue;
      }
      const autoApprove = effectiveCfg?.autoApprove || false;
      const { data: inserted, error: insertErr } = await supabase
        .from("suggestions")
        .insert({
          user_id: resolvedUserId,
          workspace_id: workspaceId,
          ghl_conversation_id: ghlConvUuid,
          type: s.type,
          title: s.title,
          description: s.description,
          status: autoApprove ? "approved" : "pending",
          action_data: {
            field: s.field || null,
            // Para mover_funil grava o nome canonico da etapa resolvida.
            value: s.type === "mover_funil" && s.__stage ? s.__stage.name : (s.value || null),
            contact_name: conversation.contact_name || null,
            contact_phone: conversation.contact_phone || null,
            // Contato canonico do GHL (multicanal) — execucao usa direto, sem
            // depender de telefone. Essencial para Instagram/Facebook.
            ghl_contact_id: conversation.ghl_contact_id || null,
            ghl_location_id: conversation.ghl_location_id || null,
            // Para auto-execucao: o cron postgres->edge so pega sugestoes com esta flag.
            ...(autoApprove ? { auto_execute_pending: true } : {}),
            ...(s.type === "mover_funil" && s.__stage ? {
              stageId: s.__stage.id,
              pipelineId: s.__stage.pipelineId,
            } : {}),
            ...(s.type === "agendar_lembrete" ? {
              task_title: s.task_title || s.value || "Entrar em contato",
              due_date: sanitizeFutureDate(s.due_date),
              task_description: s.description || null,
            } : {}),
            ...(s.type === "ganho_perdido" && s.lost_reason_id ? {
              lostReasonId: s.lost_reason_id,
              lostReasonName: lostReasonsMap[s.lost_reason_id] || null,
            } : {}),
          },
          ai_provider: buildAiProviderString(providerConfig || null, resolved),
          prompt_version: PROMPT_VERSION,
        })
        .select()
        .single();

      if (insertErr) {
        console.error("Error inserting suggestion:", insertErr);
      } else if (inserted) {
        insertedSuggestions.push(inserted);
        // NOTA: auto-execucao (auto_approve) nao e disparada aqui — exigiria
        // chamada edge->edge para ghl-manage, que falha nesse Supabase. Sugestoes
        // auto-aprovadas ficam como 'approved' para execucao via UI/fluxo proprio.
      }
    }

    // Limpa debounce + marca analisado
    await supabase
      .from("ghl_conversations")
      .update({ analyze_after: null, analyze_started_at: null, last_analyzed_at: new Date().toISOString() })
      .eq("id", ghlConvUuid);

    console.log(`[v2] Generated ${insertedSuggestions.length} suggestions for ghl_conversation ${ghlConversationId}`);

    return new Response(
      JSON.stringify({ success: true, data: { suggestions: insertedSuggestions } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("ai-analyze-v2 error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    await reportEdgeError("edge:ai-analyze-v2", error);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
