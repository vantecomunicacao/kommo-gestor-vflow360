export const FUNNEL_BUCKETS = [
  { key: "contato_inicial", label: "Contato Inicial" },
  { key: "proposta_enviada", label: "Proposta Enviada" },
  { key: "fechamento", label: "Fechamento" },
  { key: "venda_ganha", label: "Venda Ganha" },
] as const;

export type FunnelBucketKey = (typeof FUNNEL_BUCKETS)[number]["key"];

/** Rótulo padrão de um bucket do funil. */
export function defaultFunnelLabel(key: string): string {
  return FUNNEL_BUCKETS.find((b) => b.key === key)?.label ?? key;
}

/**
 * Resolve o rótulo exibido de um bucket, aplicando o override do workspace
 * (dashboard_settings.funnel_stage_labels) quando houver. Strings vazias caem
 * no rótulo padrão.
 */
export function resolveFunnelLabel(
  key: string,
  overrides?: Record<string, string> | null,
): string {
  const custom = overrides?.[key]?.trim();
  return custom || defaultFunnelLabel(key);
}

export const DATE_TYPES = ["DATE", "DATETIME", "DATE_TIME", "date", "datetime", "Date", "DateTime"];
