// VFlow360 Kommo — paginação de leitura no Supabase/PostgREST.
//
// Por quê: o PostgREST tem um teto de linhas por resposta (`db-max-rows`, padrão
// 1000). Um `.limit(10000)` NÃO vence esse teto — ele só ajusta o header Range.
// Resultado: qualquer tabela com mais de 1000 linhas no escopo era silenciosamente
// truncada em 1000 (total de leads "fixado em mil", funil/tarefas subcontados).
// Este helper varre a coleção inteira em blocos via `.range()`, exatamente como o
// lado GHL já fazia em `dashboard-metrics.ts`.
//
// Uso: passe uma factory que monta a query COMPLETA (filtros + `.order()` +
// `.range(from, to)`). A ordenação por uma chave estável (ex.: kommo_id) é
// obrigatória para a paginação ser determinística — sem ela, o PostgREST pode
// repetir ou pular linhas entre páginas.
//
//   const rows = await fetchAllRows((from, to) =>
//     db.from("leads").select("...").eq("workspace_id", ws)
//       .order("kommo_id").range(from, to));

export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { page?: number } = {},
): Promise<T[]> {
  const PAGE = opts.page ?? 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break; // última página (veio incompleta) → acabou
  }
  return out;
}
