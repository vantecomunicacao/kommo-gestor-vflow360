import { LeadOrigin } from "@/hooks/useKommoData";

export const OUTRAS_LABEL = "Outras";
export const NAO_IDENTIFICADO_LABEL = "Não identificado";
export const NAO_INFORMADO_LABEL = "Não informado";

/** Labels que sempre aparecem ao final do pie e nunca entram no bucketing Top N. */
const RESERVED_LABELS = [NAO_IDENTIFICADO_LABEL, NAO_INFORMADO_LABEL];

/**
 * Agrupa uma distribuição em Top N + "Outras", preservando labels reservados
 * ("Não identificado", "Não informado") como fatias separadas no final.
 *
 * Assume entrada já ordenada por count desc com desempate alfabético, com
 * labels reservados no final quando presentes.
 */
export function groupTopN(items: LeadOrigin[], n = 6): LeadOrigin[] {
  if (!items || items.length === 0) return [];

  const reserved = items.filter((i) => RESERVED_LABELS.includes(i.name));
  const known = items.filter((i) => !RESERVED_LABELS.includes(i.name));

  let result: LeadOrigin[];
  if (known.length <= n + 1) {
    result = known;
  } else {
    const top = known.slice(0, n);
    const rest = known.slice(n);
    const restCount = rest.reduce((a, b) => a + b.count, 0);
    const restPct = rest.reduce((a, b) => a + b.percentage, 0);
    result = [
      ...top,
      { name: OUTRAS_LABEL, count: restCount, percentage: restPct },
    ];
  }

  return [...result, ...reserved];
}
