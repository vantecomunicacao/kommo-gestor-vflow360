// Extraído de src/pages/Dashboard.tsx (Fase 5, Passo 3 — só a metade "persistência"
// do plano; a metade "hidratação" ficou de propósito de fora, é a parte delicada
// da ordem URL > localStorage > funil padrão, documentada inline no componente).
// Extração mecânica: mesmo efeito, mesmas dependências, sem mudança de comportamento.

import { useEffect } from "react";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { SetURLSearchParams } from "react-router-dom";
import { DateBasis } from "@/lib/report-axis";
import { SavedFilters, filtersStorageKey } from "@/lib/dashboard-filters-storage";

export interface DashboardFilterPersistenceState {
  hydrated: boolean;
  workspaceId: string | null | undefined;
  dateRange: DateRange | undefined;
  selectedPipelineIds: string[];
  selectedStageIds: string[];
  selectedSellerIds: string[];
  selectedUtmMediums: string[];
  selectedUtmCampaigns: string[];
  selectedOrigins: string[];
  selectedCustomFilters: Record<string, string[]>;
  dateBasis: DateBasis;
  setSearchParams: SetURLSearchParams;
}

/** Grava os filtros atuais no localStorage (por workspace) e espelha na URL (deep link). */
export function useDashboardFilterPersistence(state: DashboardFilterPersistenceState): void {
  const {
    hydrated, workspaceId, dateRange, selectedPipelineIds, selectedStageIds, selectedSellerIds,
    selectedUtmMediums, selectedUtmCampaigns, selectedOrigins, selectedCustomFilters, dateBasis,
    setSearchParams,
  } = state;

  useEffect(() => {
    if (!hydrated || !workspaceId) return;
    const payload: SavedFilters = {
      from: dateRange?.from ? dateRange.from.toISOString() : undefined,
      to: dateRange?.to ? dateRange.to.toISOString() : undefined,
      pipelineIds: selectedPipelineIds,
      stageIds: selectedStageIds,
      sellerIds: selectedSellerIds,
      utmMediums: selectedUtmMediums,
      utmCampaigns: selectedUtmCampaigns,
      origins: selectedOrigins,
      customFilters: selectedCustomFilters,
      dateBasis,
    };
    try {
      localStorage.setItem(filtersStorageKey(workspaceId), JSON.stringify(payload));
    } catch {
      // ignora quota cheia
    }

    // Mantém a URL como espelho do filtro atual (deep link) — replace pra não
    // empilhar histórico de navegação a cada clique de filtro.
    const nextParams = new URLSearchParams();
    if (selectedPipelineIds.length) nextParams.set("pipelines", selectedPipelineIds.join(","));
    if (selectedStageIds.length) nextParams.set("stages", selectedStageIds.join(","));
    if (selectedSellerIds.length) nextParams.set("sellers", selectedSellerIds.join(","));
    if (selectedUtmMediums.length) nextParams.set("utmMedium", selectedUtmMediums.join(","));
    if (selectedUtmCampaigns.length) nextParams.set("utmCampaign", selectedUtmCampaigns.join(","));
    if (selectedOrigins.length) nextParams.set("origin", selectedOrigins.join(","));
    const nonEmptyCustomFilters = Object.fromEntries(Object.entries(selectedCustomFilters).filter(([, v]) => v.length));
    if (Object.keys(nonEmptyCustomFilters).length) nextParams.set("cf", JSON.stringify(nonEmptyCustomFilters));
    if (dateBasis === "fechamento") nextParams.set("axis", "fechamento");
    if (dateRange?.from) nextParams.set("from", format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) nextParams.set("to", format(dateRange.to, "yyyy-MM-dd"));
    setSearchParams(nextParams, { replace: true });
  }, [hydrated, workspaceId, dateRange, selectedPipelineIds, selectedStageIds, selectedSellerIds, selectedUtmMediums, selectedUtmCampaigns, selectedOrigins, selectedCustomFilters, dateBasis, setSearchParams]);
}
