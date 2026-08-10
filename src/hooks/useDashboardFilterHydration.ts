// Extraído de src/pages/Dashboard.tsx — hidratação inicial dos filtros do
// Dashboard (URL/deep-link > localStorage > funil padrão do workspace >
// default). Extração mecânica: mesma lógica, mesmas dependências, sem
// mudança de comportamento. Ver useDashboardFilterPersistence.ts para a
// metade "gravar" desse mesmo par (hidratar/persistir).

import { useEffect, useState } from "react";
import { subDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { DateBasis } from "@/lib/report-axis";
import { type SavedFilters, filtersStorageKey, parseCsvParam, parseCustomFiltersParam, parseLocalDateParam } from "@/lib/dashboard-filters-storage";
import { supabase } from "@/integrations/supabase/client";

const defaultDateRange = (): DateRange => ({
  from: subDays(new Date(), 7),
  to: subDays(new Date(), 1),
});

export function useDashboardFilterHydration(workspaceId: string | undefined, searchParams: URLSearchParams) {
  const [hydrated, setHydrated] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(defaultDateRange());
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [selectedSellerIds, setSelectedSellerIds] = useState<string[]>([]);
  const [selectedUtmMediums, setSelectedUtmMediums] = useState<string[]>([]);
  const [selectedUtmCampaigns, setSelectedUtmCampaigns] = useState<string[]>([]);
  const [selectedOrigins, setSelectedOrigins] = useState<string[]>([]);
  const [selectedCustomFilters, setSelectedCustomFilters] = useState<Record<string, string[]>>({});
  const [dateBasis, setDateBasis] = useState<DateBasis>("criacao");
  const [stageLabels, setStageLabels] = useState<Record<string, string>>({});
  const [defaultPipelineIds, setDefaultPipelineIds] = useState<string[]>([]);

  // Hidratar filtros salvos por workspace (ou aplicar pipeline padrão)
  useEffect(() => {
    setHydrated(false);
    if (!workspaceId) return;
    let cancelled = false;

    (async () => {
      // 0) Funil padrão do workspace — sempre tem prioridade na abertura do dashboard.
      const { data: settings } = await supabase
        .from("dashboard_settings")
        .select("default_pipeline_ids, funnel_stage_labels")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (cancelled) return;
      setStageLabels((settings?.funnel_stage_labels as Record<string, string>) || {});
      setDefaultPipelineIds((settings?.default_pipeline_ids as string[]) || []);

      // Deep link: se a URL já tem algum filtro, ela vence — inclusive sobre o funil
      // padrão do workspace, porque um link compartilhado é uma intenção explícita de
      // quem gerou o link. Não olha localStorage nesse caso.
      const urlPipelines = parseCsvParam(searchParams.get("pipelines"));
      const urlStages = parseCsvParam(searchParams.get("stages"));
      const urlSellers = parseCsvParam(searchParams.get("sellers"));
      const urlUtmMediums = parseCsvParam(searchParams.get("utmMedium"));
      const urlUtmCampaigns = parseCsvParam(searchParams.get("utmCampaign"));
      const urlOrigins = parseCsvParam(searchParams.get("origin"));
      const urlCustomFilters = parseCustomFiltersParam(searchParams.get("cf"));
      const urlAxis = searchParams.get("axis");
      const urlFrom = searchParams.get("from");
      const urlTo = searchParams.get("to");
      const hasUrlFilters = !!(urlPipelines.length || urlStages.length || urlSellers.length
        || urlUtmMediums.length || urlUtmCampaigns.length || urlOrigins.length
        || Object.keys(urlCustomFilters).length || urlAxis || urlFrom || urlTo);

      if (hasUrlFilters) {
        setDateRange(
          urlFrom
            ? { from: parseLocalDateParam(urlFrom), to: urlTo ? parseLocalDateParam(urlTo) : undefined }
            : defaultDateRange()
        );
        setSelectedPipelineIds(urlPipelines);
        setSelectedStageIds(urlStages);
        setSelectedSellerIds(urlSellers);
        setSelectedUtmMediums(urlUtmMediums);
        setSelectedUtmCampaigns(urlUtmCampaigns);
        setSelectedOrigins(urlOrigins);
        setSelectedCustomFilters(urlCustomFilters);
        setDateBasis(urlAxis === "fechamento" ? "fechamento" : "criacao");
        if (!cancelled) setHydrated(true);
        return;
      }

      // Funil(is) padrão do workspace — pré-selecionados na abertura (o filtro do
      // Dashboard aceita múltiplos funis, igual esse campo de Configurações).
      const defaultPipelineIds: string[] = settings?.default_pipeline_ids || [];

      // 1) Restaurar filtros salvos (período, vendedores, UTM…)
      let restoredPipelineIds: string[] = [];
      let restored = false;
      try {
        const raw = localStorage.getItem(filtersStorageKey(workspaceId));
        if (raw) {
          const saved = JSON.parse(raw) as SavedFilters;
          setDateRange(
            saved.from
              ? { from: new Date(saved.from), to: saved.to ? new Date(saved.to) : undefined }
              : defaultDateRange()
          );
          restoredPipelineIds = saved.pipelineIds ?? (saved.pipelineId ? [saved.pipelineId] : []);
          setSelectedStageIds(saved.stageIds ?? (saved.stageId ? [saved.stageId] : []));
          setSelectedSellerIds(saved.sellerIds ?? (saved.sellerId ? [saved.sellerId] : []));
          setSelectedUtmMediums(saved.utmMediums ?? (saved.utmMedium ? [saved.utmMedium] : []));
          setSelectedUtmCampaigns(saved.utmCampaigns ?? (saved.utmCampaign ? [saved.utmCampaign] : []));
          setSelectedOrigins(saved.origins ?? (saved.origin ? [saved.origin] : []));
          setSelectedCustomFilters(saved.customFilters ?? {});
          setDateBasis(saved.dateBasis === "fechamento" ? "fechamento" : "criacao");
          restored = true;
        }
      } catch {
        // ignora storage corrompido
      }

      if (!restored) {
        // Reset padrão
        setDateRange(defaultDateRange());
        setSelectedSellerIds([]);
        setSelectedUtmMediums([]);
        setSelectedUtmCampaigns([]);
        setSelectedOrigins([]);
        setSelectedCustomFilters({});
        setSelectedStageIds([]);
        setDateBasis("criacao");
      }

      // 2) Pipeline: o(s) funil(is) padrão configurado(s) vencem na abertura. Se as
      //    etapas salvas eram de outro funil, limpa (etapas são específicas de um funil).
      if (defaultPipelineIds.length) {
        setSelectedPipelineIds(defaultPipelineIds);
        const sameSelection = restoredPipelineIds.length === defaultPipelineIds.length
          && restoredPipelineIds.every((id) => defaultPipelineIds.includes(id));
        if (restored && !sameSelection) setSelectedStageIds([]);
      } else {
        setSelectedPipelineIds(restored ? restoredPipelineIds : []);
      }

      if (!cancelled) setHydrated(true);
    })();

    return () => { cancelled = true; };
    // searchParams de propósito fora das deps: só deve ler a URL na abertura/troca de
    // workspace, não a cada vez que o efeito de persistência (fora deste hook) a
    // reescreve (senão vira loop de hidratação).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return {
    hydrated,
    dateRange, setDateRange,
    selectedPipelineIds, setSelectedPipelineIds,
    selectedStageIds, setSelectedStageIds,
    selectedSellerIds, setSelectedSellerIds,
    selectedUtmMediums, setSelectedUtmMediums,
    selectedUtmCampaigns, setSelectedUtmCampaigns,
    selectedOrigins, setSelectedOrigins,
    selectedCustomFilters, setSelectedCustomFilters,
    dateBasis, setDateBasis,
    stageLabels,
    defaultPipelineIds,
  };
}
