// Extração de valores de campo personalizado de um lead do Kommo — usado por
// kommo-dashboard (filtros, distribuições, Métricas Personalizadas) e por
// kommo-report-snapshot (Métricas Personalizadas com lado de campo — ver
// _shared/custom-metrics-count.ts). Relocado de kommo-dashboard/pure.ts (que
// continua reexportando daqui, sem quebrar os ~15 pontos de uso existentes)
// porque agora as duas edge functions precisam disso, não só uma.

/** Item de `custom_fields` como gravado pelo kommo-sync (jsonb, sem schema fixo). */
interface CustomFieldRow {
  field_code?: string | number;
  field_id?: string | number;
  values?: Array<{ value?: unknown }>;
}

function asCustomFieldRows(cfv: unknown): CustomFieldRow[] {
  return Array.isArray(cfv) ? (cfv as CustomFieldRow[]) : [];
}

/** Extrai valor de um custom field de lead (array custom_fields_values) por code/id. */
export function extractCf(cfv: unknown, codeOrId: string | null): string | null {
  if (!codeOrId) return null;
  for (const f of asCustomFieldRows(cfv)) {
    if (String(f?.field_code ?? "") === codeOrId || String(f?.field_id ?? "") === codeOrId) {
      const vals = (f?.values ?? []).map((v) => v?.value).filter((v) => v != null && String(v).trim() !== "");
      return vals.length ? vals.join(", ") : null;
    }
  }
  return null;
}

/** Valor de um custom field do tipo DATA como Date (Kommo grava unix em segundos). */
export function extractCfDate(cfv: unknown, codeOrId: string | null): Date | null {
  const vals = extractCfValues(cfv, codeOrId);
  if (!vals.length) return null;
  const n = Number(vals[0]);
  if (!Number.isFinite(n)) {
    const d = new Date(vals[0]);
    return isNaN(d.getTime()) ? null : d;
  }
  // unix em segundos (Kommo) → ms
  return new Date(n * 1000);
}

/** Como extractCf, mas devolve cada valor individualmente (p/ multiselect e distribuição). */
export function extractCfValues(cfv: unknown, codeOrId: string | null): string[] {
  if (!codeOrId) return [];
  for (const f of asCustomFieldRows(cfv)) {
    if (String(f?.field_code ?? "") === codeOrId || String(f?.field_id ?? "") === codeOrId) {
      return (f?.values ?? [])
        .map((v) => v?.value)
        .filter((v) => v != null && String(v).trim() !== "")
        .map((v) => String(v));
    }
  }
  return [];
}
