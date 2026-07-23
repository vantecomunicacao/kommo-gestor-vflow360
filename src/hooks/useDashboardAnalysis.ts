import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Interpretação estruturada do pedido (passo "parse"). Datas em ISO YYYY-MM-DD.
export interface AnalysisInterpretation {
  intent: "analise" | "pergunta";
  pipelineId: string | null;
  pipelineName: string | null;
  startDate: string;
  endDate: string;
  dateBasis: "criacao" | "fechamento";
  compare: boolean;
  compareStart: string | null;
  compareEnd: string | null;
  foco: string;
  confirmacao: string[];
}

// Parâmetros CONFIRMADOS pelo gestor, enviados ao passo "analyze".
export interface AnalysisParams {
  pipelineId: string | null;
  startDate: string;
  endDate: string;
  dateBasis: "criacao" | "fechamento";
  compare: boolean;
  compareStart: string | null;
  compareEnd: string | null;
  foco: string;
  intent?: "analise" | "pergunta"; // "pergunta" => relatório compacto (só a resposta)
}

export interface ChatMessage { role: "user" | "assistant"; content: string }

export interface AnalysisRecord {
  id: string;
  prompt: string;
  params: Record<string, unknown> | null;
  result: string;
  metrics: AnalysisMetrics | null;
  messages: ChatMessage[] | null;
  pinned: boolean | null;
  model: string | null;
  cost_usd: number | null;
  created_at: string;
}

// Snapshot compacto devolvido pela edge (mesma forma de summarizeMetrics no backend).
export interface PeriodMetrics {
  totalLeads: number;
  lostLeads: number;
  funnelStages: { id: string; name: string; count: number }[];
  conversionRates: Record<string, number>;
  monetary: { total: number; won: number; lost: number; negotiating: number };
  cycleToWonDays: number | null;
  cycleToLostDays: number | null;
  lossReasons: { name: string; count: number }[];
  sellers: { name: string; contatoInicial: number; propostaEnviada: number; fechamento: number; vendaGanha: number; wonRevenue: number }[];
}
export interface AnalysisMetrics {
  principal: PeriodMetrics | null;
  comparacao: PeriodMetrics | null;
}

interface ParseResponse {
  interpretation: AnalysisInterpretation;
  pipelines: { id: string; name: string }[];
  model: string;
  cost_usd: number;
}

interface AnalyzeResponse {
  id: string | null;
  created_at: string | null;
  prompt: string;
  result: string;
  params: Record<string, unknown>;
  metrics: AnalysisMetrics;
  messages: ChatMessage[];
}

interface FollowupResponse {
  answer: string;
  messages: ChatMessage[];
}

async function unwrap<T>(data: unknown, error: { message: string; context?: Response } | null): Promise<T> {
  if (error) {
    // supabase-js esconde o corpo em erros non-2xx; lê o { error } real da edge.
    try {
      const body = await error.context?.clone().json();
      if (body?.error) throw new Error(body.error as string);
    } catch (e) { if (e instanceof Error && e.message && !/json/i.test(e.message)) throw e; }
    throw new Error(error.message);
  }
  const err = (data as { error?: string } | null)?.error;
  if (err) throw new Error(err);
  return (data as { data: T }).data;
}

// Passo 1: interpreta o prompt livre (não grava, custo ~zero).
export function useParseAnalysis(workspaceId: string | null | undefined) {
  return useMutation<ParseResponse, Error, string>({
    mutationFn: async (prompt) => {
      const { data, error } = await supabase.functions.invoke("kommo-ai-analyze", {
        body: { mode: "parse", workspace_id: workspaceId, prompt },
      });
      return unwrap<ParseResponse>(data, error);
    },
  });
}

// Passo 2: roda a análise com os parâmetros confirmados e grava no histórico.
export function useRunAnalysis(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation<AnalyzeResponse, Error, { prompt: string; params: AnalysisParams }>({
    mutationFn: async ({ prompt, params }) => {
      const { data, error } = await supabase.functions.invoke("kommo-ai-analyze", {
        body: { mode: "analyze", workspace_id: workspaceId, prompt, params },
      });
      return unwrap<AnalyzeResponse>(data, error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-analyses", workspaceId] });
    },
  });
}

// Passo 3 (opcional): pergunta de acompanhamento numa análise existente. NÃO re-consulta
// o CRM — reusa o snapshot já salvo. Devolve a resposta + a conversa completa atualizada.
export function useFollowup(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation<FollowupResponse, Error, { analysisId: string; question: string }>({
    mutationFn: async ({ analysisId, question }) => {
      const { data, error } = await supabase.functions.invoke("kommo-ai-analyze", {
        body: { mode: "followup", workspace_id: workspaceId, analysis_id: analysisId, prompt: question },
      });
      return unwrap<FollowupResponse>(data, error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-analyses", workspaceId] });
    },
  });
}

// Exclui uma análise do histórico (via edge, service role).
export function useDeleteAnalysis(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: async (analysisId) => {
      const { data, error } = await supabase.functions.invoke("kommo-ai-analyze", {
        body: { mode: "delete", workspace_id: workspaceId, analysis_id: analysisId },
      });
      return unwrap<{ id: string }>(data, error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard-analyses", workspaceId] }),
  });
}

// Fixa/desafixa uma análise (via edge, service role).
export function usePinAnalysis(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, Error, { analysisId: string; pinned: boolean }>({
    mutationFn: async ({ analysisId, pinned }) => {
      const { data, error } = await supabase.functions.invoke("kommo-ai-analyze", {
        body: { mode: "pin", workspace_id: workspaceId, analysis_id: analysisId, pinned },
      });
      return unwrap<{ id: string }>(data, error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard-analyses", workspaceId] }),
  });
}

// Streaming da análise (texto incremental). Usa fetch direto porque functions.invoke
// bufferiza a resposta. Protocolo NDJSON: meta -> delta* -> done|error.
export interface StreamCallbacks {
  onMeta: (m: { prompt: string; params: Record<string, unknown>; metrics: AnalysisMetrics }) => void;
  onDelta: (text: string) => void;
  onDone: (d: { id: string | null; created_at: string | null }) => void;
}
export async function streamAnalyze(
  workspaceId: string, prompt: string, params: AnalysisParams, cb: StreamCallbacks,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kommo-ai-analyze`;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "analyze", workspace_id: workspaceId, prompt, params, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`Falha ao iniciar a análise [${res.status}]`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() || "";
    for (const line of parts) {
      const t = line.trim();
      if (!t) continue;
      let ev: any;
      try { ev = JSON.parse(t); } catch { continue; }
      if (ev.type === "meta") cb.onMeta(ev);
      else if (ev.type === "delta") cb.onDelta(ev.text as string);
      else if (ev.type === "done") cb.onDone(ev);
      else if (ev.type === "error") throw new Error(ev.error || "Falha na análise");
    }
  }
}

// Histórico das análises do workspace (RLS: só membros). Fixados no topo, depois recentes.
export function useAnalysisHistory(workspaceId: string | null | undefined) {
  return useQuery<AnalysisRecord[], Error>({
    queryKey: ["dashboard-analyses", workspaceId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("dashboard_analyses" as any) as any)
        .select("id, prompt, params, result, metrics, messages, pinned, model, cost_usd, created_at")
        .eq("workspace_id", workspaceId as string)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data || []) as AnalysisRecord[];
    },
    enabled: !!workspaceId,
  });
}
