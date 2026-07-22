import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Interpretação estruturada do pedido (passo "parse"). Datas em ISO YYYY-MM-DD.
export interface AnalysisInterpretation {
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
}

export interface AnalysisRecord {
  id: string;
  prompt: string;
  params: Record<string, unknown> | null;
  result: string;
  metrics: AnalysisMetrics | null;
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
  result: string;
  params: Record<string, unknown>;
  metrics: AnalysisMetrics;
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
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

// Histórico das análises do workspace (RLS: só membros; mais recentes primeiro).
export function useAnalysisHistory(workspaceId: string | null | undefined) {
  return useQuery<AnalysisRecord[], Error>({
    queryKey: ["dashboard-analyses", workspaceId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("dashboard_analyses" as any) as any)
        .select("id, prompt, params, result, metrics, model, cost_usd, created_at")
        .eq("workspace_id", workspaceId as string)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data || []) as AnalysisRecord[];
    },
    enabled: !!workspaceId,
  });
}
