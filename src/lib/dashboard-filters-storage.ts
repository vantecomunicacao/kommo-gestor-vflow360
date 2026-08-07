// Extraído de src/pages/Dashboard.tsx (Fase 5 do plano de remediação, 2026-08) —
// tipos e helpers puros de (de)serialização de filtros (localStorage + deep link
// via querystring). Extração mecânica, mesmo código, sem mudança de comportamento.

import type { DateBasis } from "@/lib/report-axis";

export type SavedFilters = {
  from?: string;
  to?: string;
  pipelineId?: string | null; // legado (seleção única)
  pipelineIds?: string[];
  stageId?: string | null; // legado (seleção única)
  stageIds?: string[];
  sellerId?: string | null; // legado (seleção única)
  sellerIds?: string[];
  utmMedium?: string | null; // legado (seleção única)
  utmMediums?: string[];
  utmCampaign?: string | null; // legado (seleção única)
  utmCampaigns?: string[];
  origin?: string | null; // legado (seleção única)
  origins?: string[];
  customFilters?: Record<string, string[]>;
  dateBasis?: DateBasis;
};

export const filtersStorageKey = (workspaceId: string) => `dashboard:filters:${workspaceId}`;

// Filtros aceitos como query param (deep link) — arrays viram string separada por
// vírgula. Ver docs/plano-filtros-dashboard.md § "Fase 5" pro design completo.
export const parseCsvParam = (v: string | null): string[] => (v ? v.split(",").filter(Boolean) : []);

// Filtros personalizados: quantidade/ids são dinâmicos (definidos em Configurações),
// então viram um único param JSON em vez de um param fixo por filtro.
export const parseCustomFiltersParam = (v: string | null): Record<string, string[]> => {
  if (!v) return {};
  try {
    const parsed = JSON.parse(v);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, val] of Object.entries(parsed)) {
      if (Array.isArray(val)) out[k] = val.filter((s) => typeof s === "string" && s);
    }
    return out;
  } catch { return {}; }
};
