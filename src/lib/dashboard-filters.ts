/**
 * Contrato compartilhado dos filtros de consulta do Dashboard (Header.tsx / Dashboard.tsx).
 * Objetivo: ter UM lugar que sabe "quais campos contam como filtro ativo" em vez de uma
 * lista hardcoded — um filtro novo só precisa entrar aqui para já valer em toda a UI.
 */
export interface ActiveFilterFlags {
  pipelineIds: string[];
  stageIds: string[];
  sellerIds: string[];
  utmMediums: string[];
  utmCampaigns: string[];
  origins: string[];
  hasAdditionalRange: boolean;
  /** Valores selecionados por filtro personalizado, chaveado pelo id do filtro. */
  customFilters?: Record<string, string[]>;
}

export function countActiveFilters(f: ActiveFilterFlags): number {
  return [
    f.pipelineIds.length > 0,
    f.stageIds.length > 0,
    f.sellerIds.length > 0,
    f.utmMediums.length > 0,
    f.utmCampaigns.length > 0,
    f.origins.length > 0,
    f.hasAdditionalRange,
    ...Object.values(f.customFilters ?? {}).map((v) => v.length > 0),
  ].filter(Boolean).length;
}
