// Mapeamento etapa do CRM → fase do funil analítico (as 5 fases do VFlow360).
//
// O `funnel_stage_mapping` nasceu indexado só pelo status_id. Só que no Kommo os
// status de sistema `142` (Venda ganha) e `143` (Venda perdida) são os MESMOS ids
// em todos os funis — e clientes renomeiam esses status por funil (na conta do
// Dr. Eduardo, o `142` do funil "Equipe Multidisciplinar" chama-se "Cirurgia
// Realizada"). Com uma chave por status, mapear o 142 num funil contaminava todos.
//
// Formato novo: chave "<pipelineId>:<statusId>". O formato antigo (só "<statusId>")
// continua sendo lido como regra que vale para qualquer funil, para não quebrar
// workspaces ainda não migrados.

export type FunnelBucket = "contato_inicial" | "qualificando" | "proposta_enviada" | "fechamento" | "venda_ganha";
export const FUNNEL_BUCKETS: FunnelBucket[] = ["contato_inicial", "qualificando", "proposta_enviada", "fechamento", "venda_ganha"];

export const FUNNEL_KEY_SEP = ":";
export function funnelKey(pipelineId: string | number, statusId: string | number): string {
  return `${pipelineId}${FUNNEL_KEY_SEP}${statusId}`;
}

export interface ParsedFunnelMapping {
  /** chave "<pipelineId>:<statusId>" → fase (tem prioridade) */
  byPipelineStage: Map<string, FunnelBucket>;
  /** chave "<statusId>" (legado) → fase; vale para qualquer funil */
  byStage: Map<string, FunnelBucket>;
  /** fases que o usuário efetivamente configurou (em qualquer um dos formatos) */
  covered: Set<FunnelBucket>;
  hasUserMapping: boolean;
}

export function parseFunnelMapping(raw: Record<string, unknown> | null | undefined): ParsedFunnelMapping {
  const byPipelineStage = new Map<string, FunnelBucket>();
  const byStage = new Map<string, FunnelBucket>();
  const covered = new Set<FunnelBucket>();
  for (const [key, value] of Object.entries(raw || {})) {
    if (typeof value !== "string" || !(FUNNEL_BUCKETS as string[]).includes(value)) continue;
    const bucket = value as FunnelBucket;
    covered.add(bucket);
    // indexOf > 0: chave "…:…" com pipeline não vazio; ":142" cai no formato antigo.
    if (key.indexOf(FUNNEL_KEY_SEP) > 0) byPipelineStage.set(key, bucket);
    else byStage.set(key.replace(FUNNEL_KEY_SEP, ""), bucket);
  }
  return { byPipelineStage, byStage, covered, hasUserMapping: covered.size > 0 };
}

/**
 * Resolvedor fase-de-um-lead. Ordem: regra do par funil+etapa → regra legada da
 * etapa → fallback (inferência por nome, usada só nas fases que o usuário não
 * configurou — mesmo comportamento histórico).
 */
export function buildBucketResolver(
  parsed: ParsedFunnelMapping,
  fallbackByStage?: Map<string, FunnelBucket>,
): (pipelineId: string | null | undefined, statusId: string | null | undefined) => FunnelBucket | null {
  return (pipelineId, statusId) => {
    if (statusId == null || statusId === "") return null;
    const sid = String(statusId);
    if (pipelineId != null && pipelineId !== "") {
      const exact = parsed.byPipelineStage.get(funnelKey(String(pipelineId), sid));
      if (exact) return exact;
    }
    return parsed.byStage.get(sid) ?? fallbackByStage?.get(sid) ?? null;
  };
}
