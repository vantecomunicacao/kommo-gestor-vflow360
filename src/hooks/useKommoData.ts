import { useCallback, useEffect, useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { StageRefLabel } from "@/lib/custom-metrics";

export interface StageLead { id: number; name: string; contactName?: string | null; }
export interface CustomMetricResult {
  id: string; name: string; format: "percent" | "number"; icon?: string; value: number | null;
  color?: "accent" | "success" | "warning" | "destructive";
  numeratorRefs?: StageRefLabel[];
  denominatorRefs?: StageRefLabel[];
  numeratorCount?: number;
  denominatorCount?: number | null;
}
export interface FunnelStage {
  id: string; name: string; count: number; currentCount?: number; leads?: StageLead[];
  /** Quantos leads que passaram por esta etapa depois foram marcados como perdidos (via histórico). */
  lostHere?: number;
  lostHereLeads?: StageLead[];
}
export interface Seller {
  id?: string;
  name: string;
  contatoInicial: number;
  propostaEnviada: number;
  fechamento: number;
  vendaGanha: number;
  wonRevenue?: number;
  avgResponseMinutes?: number | null;
  responseCount?: number;
}
export interface LeadOrigin { name: string; count: number; percentage: number; }
export interface CustomField {
  name: string;
  filledPercentage: number;
  emptyPercentage: number;
  totalLeads: number;
  filledCount: number;
}
export interface ConversionRates {
  contatoToProsposta: number;
  propostaToFechamento: number;
  fechamentoToVenda: number;
  overallConversion: number;
}
export interface AverageTimePerStage {
  contatoInicial: number;
  propostaEnviada: number;
  fechamento: number;
}
export interface FunnelVelocity {
  movimentacoes: number;
  leadsMovidos: number;
  avancaram: number;
  ganhos: number;
  perdidos: number;
}
export interface FollowUp {
  tarefasAtrasadas: number;
  tarefasHoje: number;
  leadsSemProximaAcao: number;
  porVendedor: { name: string; atrasadas: number }[];
}
export interface PipelineStage { id: string; name: string; }
export interface Pipeline { id: string; name: string; stages?: PipelineStage[]; }
export interface User { id: string; name: string; }
export interface DailyLead { date: string; count: number; won: number; lost: number; dayName: string; }
export interface LossReason { reason: string; count: number; }
export interface CustomFieldDistribution {
  key: string;
  name: string;
  totalLeads: number;
  filledCount: number;
  distribution: { name: string; count: number; percentage: number }[];
}
export interface CoolingLead {
  name: string;
  seller: string | null;
  days: number;
  // Presentes apenas quando vindos da edge function `cooling-leads` (não do dashboard),
  // usados para agir no lead (criar tarefa / aplicar tag) via `kommo-actions`.
  kommo_id?: string;
  responsible_user_id?: string | null;
  taskDone?: boolean; // já tem tarefa (criada pelo vflow ou tarefa aberta no Kommo)
  tagDone?: boolean;  // tag já aplicada pelo vflow
  pipeline?: string | null;
  stage?: string | null;
}
export interface CoolingLeads {
  warning: number;  // 7–9 dias parado
  alert: number;    // 10–13 dias parado
  critical: number; // 14+ dias parado
  total: number;
  revenue?: { warning: number; alert: number; critical: number; total: number };
  thresholds: { warning: number; alert: number; critical: number };
  leads?: { warning: CoolingLead[]; alert: CoolingLead[]; critical: CoolingLead[] };
}
export interface CustomFilterDef { id: string; label: string; }
export interface UnansweredConversation { name: string; seller: string | null; waitingDays: number; }
export interface ResponseTime {
  averageMinutes: number;
  responseCount: number;
  conversationsAnalyzed: number;
  conversationsWithInbound?: number;
  businessHoursStart: string;
  businessHoursEnd: string;
  unanswered?: UnansweredConversation[];
}

export interface DashboardData {
  totalLeads: number;
  lostLeads: number;
  lostLeadsDetail?: StageLead[];
  funnelStages: FunnelStage[];
  conversionRates: ConversionRates;
  sellers: Seller[];
  utmMediumValues: string[];
  utmCampaignValues: string[];
  originValues: string[];
  leadsOriginDistribution: LeadOrigin[];
  leadsOriginFillRate: number;
  wonOriginDistribution: LeadOrigin[];
  wonOriginFillRate: number;
  utmConfigured: { source: boolean; medium: boolean; campaign: boolean; content: boolean; term: boolean };
  customFields: CustomField[];
  customFieldDistributions?: CustomFieldDistribution[];
  averageTimePerStage: AverageTimePerStage;
  funnelVelocity?: FunnelVelocity;
  followUp?: FollowUp;
  cycleToWonDays?: number;
  cycleToWonSample?: number;
  cycleToLostDays?: number;
  cycleToLostSample?: number;
  dailyLeads: DailyLead[];
  pipelines: Pipeline[];
  users: User[];
  overallFillRate: number;
  lossReasons: LossReason[];
  totalMonetary?: number;
  wonMonetary?: number;
  lostMonetary?: number;
  negotiatingMonetary?: number;
  openPipelineRevenue?: number;
  openPipelineCount?: number;
  customFilterDefs?: CustomFilterDef[];
  customFilterValues?: Record<string, string[]>;
  cachedAt?: string;
  responseTime?: ResponseTime | null;
  customMetrics?: CustomMetricResult[];
}

export interface DashboardFilters {
  startDate: Date;
  endDate: Date;
  pipelineIds: string[];
  stageIds: string[];
  sellerIds: string[];
  utmMediums: string[];
  utmCampaigns: string[];
  origins: string[];
  /** Valores selecionados por filtro personalizado, chaveado pelo id do filtro (Configurações → Filtros). */
  customFilters?: Record<string, string[]>;
  workspaceId: string | null;
  additionalStartDate?: Date | null;
  additionalEndDate?: Date | null;
  /** Eixo de data do período: "criacao" (aba Comercial) ou "fechamento" (aba Financeiro). Default: "criacao". */
  dateBasis?: "criacao" | "fechamento";
}

interface UseGhlDataOptions {
  /** Defaults true. Pass false to hold the fetch (eg. wait for the primary query). */
  enabled?: boolean;
}

interface UseGhlDataReturn {
  data: DashboardData | null;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: (forceRefresh?: boolean) => Promise<void>;
  cachedAt: string | null;
}

export function useKommoData(filters: DashboardFilters, options: UseGhlDataOptions = {}): UseGhlDataReturn {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryKey = useMemo(
    () => [
      "kommo-dashboard",
      filters.workspaceId,
      filters.startDate.getTime(),
      filters.endDate.getTime(),
      [...filters.pipelineIds].sort().join(","),
      [...filters.stageIds].sort().join(","),
      [...filters.sellerIds].sort().join(","),
      [...filters.utmMediums].sort().join(","),
      [...filters.utmCampaigns].sort().join(","),
      [...filters.origins].sort().join(","),
      JSON.stringify(
        Object.entries(filters.customFilters ?? {}).sort(([a], [b]) => a.localeCompare(b))
          .map(([id, values]) => [id, [...values].sort()]),
      ),
      filters.additionalStartDate?.getTime() ?? null,
      filters.additionalEndDate?.getTime() ?? null,
      filters.dateBasis ?? "criacao",
    ],
    [
      filters.workspaceId,
      filters.startDate,
      filters.endDate,
      filters.pipelineIds,
      filters.stageIds,
      filters.sellerIds,
      filters.utmMediums,
      filters.utmCampaigns,
      filters.origins,
      filters.customFilters,
      filters.additionalStartDate,
      filters.additionalEndDate,
      filters.dateBasis,
    ],
  );

  const query = useQuery<DashboardData, Error>({
    queryKey,
    queryFn: async () => {
      const { data: responseData, error: functionError } = await supabase.functions.invoke("kommo-dashboard", {
        body: {
          workspace_id: filters.workspaceId,
          startDate: filters.startDate.toISOString(),
          endDate: filters.endDate.toISOString(),
          pipelineId: filters.pipelineIds,
          stageIds: filters.stageIds,
          sellerIds: filters.sellerIds,
          utmMedium: filters.utmMediums,
          utmCampaign: filters.utmCampaigns,
          origin: filters.origins,
          customFilters: filters.customFilters ?? {},
          additionalStartDate: filters.additionalStartDate ? filters.additionalStartDate.toISOString() : null,
          additionalEndDate: filters.additionalEndDate ? filters.additionalEndDate.toISOString() : null,
          dateBasis: filters.dateBasis ?? "criacao",
        },
      });
      if (functionError) throw new Error(functionError.message);
      const errMaybe = (responseData as { error?: string } | null)?.error;
      if (errMaybe) throw new Error(errMaybe);
      return responseData as DashboardData;
    },
    enabled: enabled && !!filters.workspaceId,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (query.error) {
      toast({
        title: "Erro ao carregar dashboard",
        description: query.error.message,
        variant: "destructive",
      });
    }
  }, [query.error, toast]);

  const syncMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!filters.workspaceId) throw new Error("Sem workspace ativo");

      // O cooldown é validado no servidor (kommo-sync usa sync_status.last_sync_at,
      // não-burlável). Se estiver no intervalo, a função responde { error: "COOLDOWN:<s>" }.
      const { data: syncData, error: syncError } = await supabase.functions.invoke("kommo-sync", {
        body: { workspace_id: filters.workspaceId },
      });
      const syncErrMsg = (syncData as { error?: string } | null)?.error;
      if (syncErrMsg) throw new Error(syncErrMsg);
      if (syncError) {
        console.warn("Sync warning:", syncError.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kommo-dashboard", filters.workspaceId] });
    },
    onError: (err) => {
      if (err.message.startsWith("COOLDOWN:")) {
        const wait = err.message.split(":")[1];
        toast({
          title: "Aguarde para sincronizar novamente",
          description: `Você pode sincronizar novamente em ${wait}s.`,
        });
      } else {
        toast({ title: "Sincronização", description: err.message });
      }
    },
  });

  const refetch = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) {
        try {
          await syncMutation.mutateAsync();
        } catch {
          // handled in onError
        }
      } else {
        await queryClient.refetchQueries({ queryKey });
      }
    },
    [syncMutation, queryClient, queryKey],
  );

  return {
    data: query.data ?? null,
    isLoading: query.isLoading || syncMutation.isPending,
    isFetching: query.isFetching || syncMutation.isPending,
    error: query.error ? query.error.message : null,
    refetch,
    cachedAt: query.data?.cachedAt ?? null,
  };
}
