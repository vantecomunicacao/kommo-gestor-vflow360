// VFlow360 Kommo — reconciliação de exclusões de leads (full-scan do kommo-sync).
//
// Separado de index.ts pra ser testável: o `serve(...)` roda no nível do módulo,
// então importar index.ts num teste dispararia o handler HTTP inteiro (mesmo
// motivo de kommo-dashboard/pure.ts).
//
// Fluxo (achado 2026-10-07, ver CLAUDE.md): a lista local de leads vivos era lida
// sem paginação e o PostgREST cortava em 1000 linhas — leads além disso nunca eram
// checados e ficavam "fantasmas" (excluídos no Kommo, ativos no Dashboard). Com a
// leitura paginada a reconciliação passa a enxergar TODOS os leads, o que aumenta o
// estrago possível de uma listagem truncada do Kommo — daí as duas travas abaixo:
// confirmar cada candidato direto no Kommo pelo ID, e um teto de proporção.

import { type KommoCreds, kommoFetchAll } from "../_shared/kommo-client.ts";

/** Acima desta fração dos leads vivos, a reconciliação não grava (provável anomalia). */
export const RECONCILE_MAX_RATIO = 0.2;
/** ...mas só a partir deste número absoluto (conta pequena apagar 5 de 20 é legítimo). */
export const RECONCILE_MIN_ABS = 50;

/** IDs que existem localmente (vivos) mas não vieram na listagem completa do Kommo. */
export function missingLeadIds(localIds: Iterable<string>, seenIds: Set<string>): string[] {
  const out: string[] = [];
  for (const id of localIds) if (!seenIds.has(id)) out.push(id);
  return out;
}

/**
 * Teto de segurança. Devolve o motivo do bloqueio (vai pro `last_sync_warning`)
 * ou null se pode gravar. `force` libera quando a exclusão em massa é real.
 */
export function reconcileGuard(toMark: number, localAlive: number, force: boolean): string | null {
  if (force) return null;
  if (toMark > RECONCILE_MIN_ABS && toMark > localAlive * RECONCILE_MAX_RATIO) {
    return `leads: reconciliação de exclusões pulada — ${toMark} de ${localAlive} leads ativos não vieram ` +
      `na listagem do Kommo (acima de ${Math.round(RECONCILE_MAX_RATIO * 100)}%). Conferir e, se for exclusão ` +
      `real, rodar via segredo interno com { full: true, force_reconcile: true }`;
  }
  return null;
}

/**
 * Confirma no Kommo, pelo ID, quais candidatos ainda existem. Lead excluído não
 * volta em `filter[id][]` (Kommo responde 204/vazio), lead vivo volta — então um
 * lead que só faltou na listagem (paginação truncada/instável) é salvo aqui.
 */
export async function aliveLeadIds(
  creds: KommoCreds, ids: string[], chunk = 100, delayMs = 180,
): Promise<Set<string>> {
  const alive = new Set<string>();
  for (let i = 0; i < ids.length; i += chunk) {
    // Mesma pausa do kommoFetchAll entre páginas (rate limit ~7 req/s do Kommo).
    if (i > 0 && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const qs = ids.slice(i, i + chunk).map((id) => `filter[id][]=${encodeURIComponent(id)}`).join("&");
    const found = await kommoFetchAll(creds, `/leads?limit=250&${qs}`, "leads", { maxPages: 2 });
    for (const l of found as Array<{ id: string | number }>) alive.add(String(l.id));
  }
  return alive;
}
