// VFlow360 Kommo — kommo-ai-analyze
// Análise de IA do Dashboard SOB DEMANDA (schema kommo, isolada do GHL).
//
// Fluxo guiado em 2 passos, para o gestor sempre CONFIRMAR antes de gerar:
//   - mode "parse"   → recebe { workspace_id, prompt }. Uma chamada barata à IA
//                      interpreta o pedido e devolve JSON estruturado (funil,
//                      período em ISO YYYY-MM-DD, eixo, comparação, foco). Não grava.
//   - mode "analyze" → recebe { workspace_id, prompt, params } (já confirmados pelo
//                      gestor). Busca os números reais chamando a edge kommo-dashboard
//                      (1x período principal + 1x comparação, se pedida), gera a
//                      análise em texto e GRAVA em kommo.dashboard_analyses (histórico).
//
// Provider/chave: lê ai_provider_config do owner do workspace (mesma chave OpenAI
// que a tela Configurações › IA usa). Custo gravado na própria linha do histórico
// (NÃO em public.ai_usage_log, que é do GHL).
//
// Auth: JWT válido + membership (via _shared/authorize.ts). Não aceita cron/anon.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeWorkspace } from "../_shared/authorize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

// Preço por 1M de tokens (USD), por modelo. Espelha _shared/ai-usage.ts (GHL) — mantido
// aqui para não depender de código do GHL e gravar o custo na tabela do próprio Kommo.
const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4-turbo": { in: 10, out: 30 },
  "gpt-3.5-turbo": { in: 0.5, out: 1.5 },
};
function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pr = PRICING[model] || { in: 0, out: 0 };
  return (promptTokens * pr.in + completionTokens * pr.out) / 1_000_000;
}

// Data-calendário de hoje (YYYY-MM-DD) em horário de Brasília, para a IA resolver
// períodos relativos ("junho", "últimos 30 dias") sem errar por causa do fuso.
function todayBRT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// YYYY-MM-DD (BRT) → limites do dia em ISO/UTC (mesma convenção do ai-assistant).
function dayStartISO(d: string): string { return new Date(`${d}T00:00:00-03:00`).toISOString(); }
function dayEndISO(d: string): string { return new Date(`${d}T23:59:59-03:00`).toISOString(); }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ProviderCfg { apiKey: string; model: string }

// Resolve a chave/modelo OpenAI da conta. A tela Configurações › IA grava em
// ai_provider_config pelo cliente travado no schema kommo → lemos pelo mesmo
// caminho. Fallback no schema public (leitura permitida) cobre instalações antigas.
async function resolveProvider(
  dbKommo: any, dbPublic: any, ownerId: string, callerId: string | null,
): Promise<ProviderCfg> {
  const ids = [ownerId, callerId].filter((v): v is string => !!v);
  for (const client of [dbKommo, dbPublic]) {
    for (const uid of ids) {
      const { data } = await client
        .from("ai_provider_config").select("provider, api_key, model")
        .eq("user_id", uid).maybeSingle();
      if (data?.provider === "openai" && data?.api_key) {
        return { apiKey: data.api_key as string, model: (data.model as string) || DEFAULT_MODEL };
      }
    }
  }
  throw new Error(
    "Nenhuma chave de IA configurada para esta conta. Configure sua chave de OpenAI em Configurações › IA.",
  );
}

// Chama a OpenAI (chat completions). Devolve { content, usage }.
async function callOpenAI(cfg: ProviderCfg, body: Record<string, unknown>): Promise<{ content: string; usage: any }> {
  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, ...body }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("AI error:", res.status, t);
    if (res.status === 429) throw new Error("Limite de uso da IA atingido. Tente em instantes.");
    if (res.status === 401) throw new Error("Chave de IA inválida. Verifique as configurações.");
    throw new Error(`Falha na IA [${res.status}]`);
  }
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content || "", usage: data.usage || {} };
}

// Invoca a edge kommo-dashboard reusando o cálculo real de métricas do Kommo,
// repassando o Authorization do gestor (a edge exige JWT+membership).
async function fetchDashboard(
  supabaseUrl: string, anonKey: string, authHeader: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${supabaseUrl}/functions/v1/kommo-dashboard`, {
    method: "POST",
    headers: { Authorization: authHeader, apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(`Falha ao buscar métricas do dashboard: ${data?.error || res.status}`);
  return data;
}

// Extrai um resumo COMPACTO da resposta do kommo-dashboard (economia de tokens +
// rastreabilidade). Só os campos que sustentam uma análise comercial.
function summarizeMetrics(d: any) {
  return {
    totalLeads: d?.totalLeads ?? 0,
    lostLeads: d?.lostLeads ?? 0,
    funnelStages: (d?.funnelStages || []).map((s: any) => ({ id: s.id, name: s.name, count: s.count })),
    conversionRates: d?.conversionRates ?? {},
    monetary: {
      total: d?.totalMonetary ?? 0, won: d?.wonMonetary ?? 0,
      lost: d?.lostMonetary ?? 0, negotiating: d?.negotiatingMonetary ?? 0,
    },
    cycleToWonDays: d?.cycleToWonDays ?? null,
    cycleToLostDays: d?.cycleToLostDays ?? null,
    lossReasons: (d?.lossReasons || []).slice(0, 10),
    sellers: (d?.sellers || []).slice(0, 15).map((s: any) => ({
      name: s.name, contatoInicial: s.contatoInicial, propostaEnviada: s.propostaEnviada,
      fechamento: s.fechamento, vendaGanha: s.vendaGanha, wonRevenue: s.wonRevenue,
    })),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const dbKommo = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "kommo" } });
    const dbPublic = createClient(SUPABASE_URL, SERVICE_KEY);

    const payload = await req.json().catch(() => ({} as any));
    const mode = payload.mode === "analyze" ? "analyze" : "parse";
    const workspaceId = payload.workspace_id as string;
    const prompt = (payload.prompt as string | undefined)?.trim();
    if (!workspaceId) throw new Error("workspace_id é obrigatório");
    if (!prompt) throw new Error("prompt é obrigatório");

    // Auth: JWT válido + membership (usuário). Sem cron/anon.
    const auth = await authorizeWorkspace({ req, db: dbKommo, supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, workspaceId });

    // Owner do workspace chaveia a chave de IA (custo atribuído à conta).
    const { data: ws } = await dbKommo.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
    const ownerId = (ws?.owner_id as string) || auth.userId || "";
    const cfg = await resolveProvider(dbKommo, dbPublic, ownerId, auth.userId);

    // Catálogo de funis (para a IA mapear nome → kommo_id e a UI montar o dropdown).
    const { data: pipeRows } = await dbKommo
      .from("pipelines").select("kommo_id, name, is_main, sort").eq("workspace_id", workspaceId);
    const pipelines = (pipeRows || []) as Array<{ kommo_id: string; name: string; is_main?: boolean; sort?: number }>;
    const pipelineList = pipelines.map((p) => `- ${p.name} (id: ${p.kommo_id})`).join("\n") || "(nenhum funil cadastrado)";

    // ===================== MODO PARSE =====================
    if (mode === "parse") {
      const sys = `Você interpreta um pedido de ANÁLISE do dashboard comercial do VFlow360. Hoje é ${todayBRT()} (America/Sao_Paulo, fuso -03:00).

Sua tarefa: transformar o pedido do gestor em parâmetros estruturados. Responda SOMENTE um JSON (sem texto fora dele) com EXATAMENTE estas chaves:
{
  "pipelineId": string|null,   // kommo_id do funil citado; null = TODOS os funis
  "pipelineName": string|null, // nome do funil (ou null)
  "startDate": "YYYY-MM-DD",   // início do período principal
  "endDate": "YYYY-MM-DD",     // fim do período principal
  "dateBasis": "criacao"|"fechamento", // "fechamento" se o pedido fala de vendas/receita fechada
  "compare": boolean,          // true se o gestor pediu comparação
  "compareStart": "YYYY-MM-DD"|null,
  "compareEnd": "YYYY-MM-DD"|null,
  "foco": string,              // 1 frase: o foco da análise (ex.: "gargalos e queda de conversão")
  "confirmacao": string[]      // itens que o gestor DEVE revisar por estarem ambíguos ou assumidos por padrão
}

Regras FIXAS (não podem ser quebradas):
- Datas SEMPRE no formato YYYY-MM-DD válido. Nunca deixe data vazia: se o período estiver ambíguo, escolha a interpretação mais provável e ADICIONE um aviso em "confirmacao".
- Períodos relativos são resolvidos a partir de hoje. "Mês passado", nomes de mês, "últimos N dias", "esta semana" etc.
- Se o gestor não citar funil → pipelineId null (todos) e adicione "Considerei TODOS os funis" em "confirmacao".
- Se o gestor não pedir comparação → compare=false, compareStart/compareEnd null.
- Se pedir comparação sem dizer com o quê → compare=true e use o período imediatamente anterior de MESMA duração; avise em "confirmacao".
- Só use um pipelineId que EXISTA na lista abaixo; se o nome citado não bater, deixe null e avise em "confirmacao".

Funis disponíveis:
${pipelineList}`;

      const { content, usage } = await callOpenAI(cfg, {
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      let interp: any = {};
      try { interp = JSON.parse(content); } catch { interp = {}; }

      // Guardrails determinísticos pós-IA: garante formato/consistência mesmo se a IA falhar.
      const today = todayBRT();
      const safeDate = (v: any, fb: string) => (typeof v === "string" && ISO_DATE.test(v) ? v : fb);
      interp.startDate = safeDate(interp.startDate, today);
      interp.endDate = safeDate(interp.endDate, today);
      interp.dateBasis = interp.dateBasis === "fechamento" ? "fechamento" : "criacao";
      interp.compare = !!interp.compare;
      interp.compareStart = interp.compare ? safeDate(interp.compareStart, null as any) : null;
      interp.compareEnd = interp.compare ? safeDate(interp.compareEnd, null as any) : null;
      if (interp.pipelineId && !pipelines.some((p) => p.kommo_id === String(interp.pipelineId))) {
        interp.pipelineId = null; interp.pipelineName = null;
      }
      if (!Array.isArray(interp.confirmacao)) interp.confirmacao = [];
      if (typeof interp.foco !== "string") interp.foco = prompt;

      const costUsd = estimateCostUsd(cfg.model, Number(usage.prompt_tokens || 0), Number(usage.completion_tokens || 0));
      return new Response(
        JSON.stringify({ success: true, data: { interpretation: interp, pipelines: pipelines.map((p) => ({ id: p.kommo_id, name: p.name })), model: cfg.model, cost_usd: Number(costUsd.toFixed(6)) } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ===================== MODO ANALYZE =====================
    const params = (payload.params || {}) as any;
    const startDate = params.startDate as string;
    const endDate = params.endDate as string;
    if (!ISO_DATE.test(startDate || "") || !ISO_DATE.test(endDate || "")) {
      throw new Error("params.startDate e params.endDate devem estar em YYYY-MM-DD");
    }
    const dateBasis = params.dateBasis === "fechamento" ? "fechamento" : "criacao";
    const pipelineId = (params.pipelineId as string | null) || null;
    const compare = !!params.compare && ISO_DATE.test(params.compareStart || "") && ISO_DATE.test(params.compareEnd || "");
    const authHeader = req.headers.get("Authorization") || "";

    const pipelineName = pipelineId
      ? (pipelines.find((p) => p.kommo_id === pipelineId)?.name || pipelineId)
      : "Todos os funis";

    // Métricas reais via kommo-dashboard (período principal + comparação opcional).
    // As duas chamadas rodam EM PARALELO — cada uma varre os leads do período, então
    // sequencial dobrava a latência.
    const [mainRaw, cmpRaw] = await Promise.all([
      fetchDashboard(SUPABASE_URL, ANON_KEY, authHeader, {
        workspace_id: workspaceId, startDate: dayStartISO(startDate), endDate: dayEndISO(endDate), dateBasis, pipelineId,
      }),
      compare
        ? fetchDashboard(SUPABASE_URL, ANON_KEY, authHeader, {
            workspace_id: workspaceId, startDate: dayStartISO(params.compareStart), endDate: dayEndISO(params.compareEnd), dateBasis, pipelineId,
          })
        : Promise.resolve(null),
    ]);
    const mainMetrics = summarizeMetrics(mainRaw);
    const compareMetrics = cmpRaw ? summarizeMetrics(cmpRaw) : null;

    const sys = `Você é um analista comercial sênior do VFlow360. Gere um RELATÓRIO ACIONÁVEL para o GESTOR a partir dos números reais fornecidos. Hoje é ${todayBRT()}.

Regras FIXAS:
- Use SOMENTE os números fornecidos no JSON. NUNCA invente dados.
- Cada afirmação relevante deve citar um número concreto (valor/variação).
- ${compare ? "Há dois períodos: 'principal' e 'comparacao'. COMPARE-os (subiu/caiu, em % quando fizer sentido)." : "Há um único período. Não invente comparações."}
- Escopo: ${pipelineName}. ${pipelineId ? "É UM funil isolado — pode falar de taxa de ganho e gargalo por etapa." : "São TODOS os funis somados — foque em VOLUME e VALOR; NÃO calcule 'conversão' somando funis diferentes."}
- Não compare um período em andamento (ainda aberto) como se estivesse fechado — sinalize quando o período incluir dias futuros/hoje.
- Português do Brasil, objetivo e profissional.

FORMATO DE SAÍDA (Markdown, obrigatório):
- Use EXATAMENTE estas seções, nesta ordem, cada título com "## " e TODO EM MAIÚSCULAS:
  "## RESUMO EXECUTIVO" (2-3 frases), "## DESTAQUES" (bullets com números),
  "## GARGALOS E RISCOS" (bullets), "## RECOMENDAÇÕES" (bullets com a AÇÃO a tomar).
- Use "- " para bullets e **negrito** para números/variações importantes.
- Seja conciso: no máximo ~3 bullets por seção. Qualidade > quantidade.

FOCO pedido pelo gestor: ${typeof params.foco === "string" && params.foco ? params.foco : prompt}`;

    const periodLabel = compare
      ? `Período principal: ${startDate} a ${endDate}. Comparação: ${params.compareStart} a ${params.compareEnd}. Eixo: ${dateBasis}.`
      : `Período: ${startDate} a ${endDate}. Eixo: ${dateBasis}.`;

    const userContent = `${periodLabel}\n\nDADOS (JSON):\n${JSON.stringify({ principal: mainMetrics, comparacao: compareMetrics }).slice(0, 14000)}`;

    const { content: answer, usage } = await callOpenAI(cfg, {
      messages: [{ role: "system", content: sys }, { role: "user", content: userContent }],
      temperature: 0.3,
    });
    const result = answer || "Não consegui concluir a análise agora. Tente reformular o pedido.";

    const costUsd = estimateCostUsd(cfg.model, Number(usage.prompt_tokens || 0), Number(usage.completion_tokens || 0));
    const savedParams = { pipelineId, pipelineName, startDate, endDate, dateBasis, compare, compareStart: compare ? params.compareStart : null, compareEnd: compare ? params.compareEnd : null, foco: params.foco ?? null };

    const { data: inserted, error: insErr } = await dbKommo.from("dashboard_analyses").insert({
      workspace_id: workspaceId,
      user_id: auth.userId,
      prompt,
      params: savedParams,
      result,
      metrics: { principal: mainMetrics, comparacao: compareMetrics },
      model: cfg.model,
      cost_usd: Number(costUsd.toFixed(6)),
    }).select("id, created_at").maybeSingle();
    if (insErr) console.error("Falha ao gravar histórico:", insErr.message);

    return new Response(
      JSON.stringify({ success: true, data: { id: inserted?.id ?? null, created_at: inserted?.created_at ?? null, result, params: savedParams, metrics: { principal: mainMetrics, comparacao: compareMetrics } } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("kommo-ai-analyze error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
