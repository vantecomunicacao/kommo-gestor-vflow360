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

/**
 * Chave do `funnel_stage_mapping`. O par funil+etapa é necessário porque os status
 * de sistema do Kommo (`142` Venda ganha, `143` Venda perdida) têm o MESMO id em
 * todos os funis e costumam ser renomeados por funil. O formato antigo (só o id da
 * etapa) continua sendo lido como regra global — ver `readStageBucket` e
 * `supabase/functions/_shared/kommo-funnel.ts`.
 */
export function funnelStageKey(pipelineId: string, stageId: string): string {
  return `${pipelineId}:${stageId}`;
}

const FUNNEL_BUCKET_KEYS: readonly string[] = FUNNEL_BUCKETS.map((b) => b.key);
const FUNNEL_KEY_SEP = ":";

/**
 * Fase configurada para (funil, etapa): chave nova ("<pipeline>:<etapa>") tem
 * prioridade sobre a legada ("<etapa>", valendo p/ qualquer funil). Espelha
 * `parseFunnelMapping`/`buildBucketResolver` de `supabase/functions/_shared/kommo-funnel.ts`
 * (se mudar a prioridade ou a normalização aqui, replicar lá e vice-versa):
 * valores fora de `FUNNEL_BUCKETS` são ignorados, e uma chave legada mal-formada
 * como ":142" é tratada igual a "142" (prefixo de separador removido).
 */
export function readStageBucket(
  mapping: Record<string, string>,
  pipelineId: string,
  stageId: string,
): string | undefined {
  const exact = mapping[funnelStageKey(pipelineId, stageId)];
  if (exact && FUNNEL_BUCKET_KEYS.includes(exact)) return exact;
  for (const [key, value] of Object.entries(mapping)) {
    if (key.indexOf(FUNNEL_KEY_SEP) > 0) continue; // formato novo (par funil+etapa), já tratado acima
    if (!value || !FUNNEL_BUCKET_KEYS.includes(value)) continue;
    if (key.replace(FUNNEL_KEY_SEP, "") === stageId) return value;
  }
  return undefined;
}

export const DATE_TYPES =["DATE", "DATETIME", "DATE_TIME", "date", "datetime", "Date", "DateTime"];
