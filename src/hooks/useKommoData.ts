import { useCallback, useEffect, useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface StageLead { id: number; name: string; }
export interface FunnelStage { id: string; name: string; count: number; currentCount?: number; leads?: StageLead[]; }
export interface Seller {
  id?: string;
  name: string;
  contatoInicial: number;
  propostaEnviada: number;
  fechamento: number;
  vendaGanha: number;
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
export interface DailyLead { date: string; count: number; dayName: string; }
export interface LossReason { reason: string; count: number; }
export interface CustomFieldDistribution {
  key: string;
  name: string;
  totalLeads: number;
  filledCount: number;
  distribution: { name: string; count: number; percentage: number }[];
}
export interface CoolingLead { name: string; seller: string | null; days: number; }
export interface CoolingLeads {
  warning: number;  // 7–9 dias parado
  alert: number;    // 10–13 dias parado
  critical: number; // 14+ dias parado
  total: number;
  thresholds: { warning: number; alert: number; critical: number };
  leads?: { warning: CoolingLead[]; alert: CoolingLead[]; critical: CoolingLead[] };
}
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
  leadOrigins: LeadOrigin[];
  origemDistribution: LeadOrigin[];
  origemFillRate: number;
  wonOrigemDistribution: LeadOrigin[];
  wonOrigemFillRate: number;
  utmSourceDistribution: LeadOrigin[];
  utmSourceFillRate: number;
  utmSourceValues: string[];
  utmMediumDistribution: LeadOrigin[];
  utmMediumFillRate: number;
  utmMediumValues: string[];
  utmCampaignDistribution: LeadOrigin[];
  utmCampaignFillRate: number;
  utmCampaignValues: string[];
  wonUtmSourceDistribution: LeadOrigin[];
  wonUtmSourceFillRate: number;
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
  origins: string[];
  overallFillRate: number;
  lossReasons: LossReason[];
  totalMonetary?: number;
  wonMonetary?: number;
  negotiatingMonetary?: number;
  cachedAt?: string;
  additionalDateFieldId?: string | null;
  additionalDateFieldName?: string | null;
  responseTime?: ResponseTime | null;
  coolingLeads?: CoolingLeads | null;
}

export interface DashboardFilters {
  startDate: Date;
  endDate: Date;
  pipelineId: string | null;
  stageIds: string[];
  sellerIds: string[];
  utmMedium: string | null;
  utmCampaign: string | null;
  workspaceId: string | null;
  additionalStartDate?: Date | null;
  additionalEndDate?: Date | null;
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

const COOLDOWN_MS = 2 * 60 * 1000;

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
      filters.pipelineId,
      [...filters.stageIds].sort().join(","),
      [...filters.sellerIds].sort().join(","),
      filters.utmMedium,
      filters.utmCampaign,
      filters.additionalStartDate?.getTime() ?? null,
      filters.additionalEndDate?.getTime() ?? null,
    ],
    [
      filters.workspaceId,
      filters.startDate,
      filters.endDate,
      filters.pipelineId,
      filters.stageIds,
      filters.sellerIds,
      filters.utmMedium,
      filters.utmCampaign,
      filters.additionalStartDate,
      filters.additionalEndDate,
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
          pipelineId: filters.pipelineId,
          stageIds: filters.stageIds,
          sellerIds: filters.sellerIds,
          utmMedium: filters.utmMedium,
          utmCampaign: filters.utmCampaign,
          additionalStartDate: filters.additionalStartDate ? filters.additionalStartDate.toISOString() : null,
          additionalEndDate: filters.additionalEndDate ? filters.additionalEndDate.toISOString() : null,
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
      const ckey = `kommo-sync-last:${filters.workspaceId}`;
      const lastStr = localStorage.getItem(ckey);
      const last = lastStr ? Number(lastStr) : 0;
      const elapsed = Date.now() - last;
      if (last && elapsed < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        throw new Error(`COOLDOWN:${wait}`);
      }
      localStorage.setItem(ckey, String(Date.now()));

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
