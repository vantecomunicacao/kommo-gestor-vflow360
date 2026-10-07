// Testes de paginate.ts — garante que fetchAllRows vence o teto de 1000 linhas
// por resposta do PostgREST (causa do bug dos leads fantasmas, 2026-10-07).

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchAllRows } from "./paginate.ts";

const MAX_ROWS = 1000; // db-max-rows do PostgREST

/** Simula o PostgREST: respeita .range(from,to) mas nunca devolve mais que MAX_ROWS. */
function fakeTable(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ kommo_id: String(i) }));
  const ranges: Array<[number, number]> = [];
  const query = (from: number, to: number) => {
    ranges.push([from, to]);
    const end = Math.min(to + 1, from + MAX_ROWS);
    return Promise.resolve({ data: rows.slice(from, end), error: null });
  };
  return { query, ranges };
}

Deno.test("fetchAllRows - traz todas as linhas acima de 1000 (caso Reymann: 1406)", async () => {
  const t = fakeTable(1406);
  const out = await fetchAllRows(t.query);
  assertEquals(out.length, 1406);
  assertEquals(new Set(out.map((r) => r.kommo_id)).size, 1406);
  assertEquals(t.ranges, [[0, 999], [1000, 1999]]);
});

Deno.test("fetchAllRows - total múltiplo de 1000 termina com página vazia", async () => {
  const t = fakeTable(2000);
  const out = await fetchAllRows(t.query);
  assertEquals(out.length, 2000);
  assertEquals(t.ranges.length, 3);
});

Deno.test("fetchAllRows - tabela vazia", async () => {
  assertEquals((await fetchAllRows(fakeTable(0).query)).length, 0);
});

Deno.test("fetchAllRows - propaga erro do banco", async () => {
  await assertRejects(() =>
    fetchAllRows(() => Promise.resolve({ data: null, error: new Error("boom") })), Error, "boom");
});
