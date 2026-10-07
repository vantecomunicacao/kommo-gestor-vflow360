// Testes de reconcile.ts — rodam via `deno test` (runner separado do vitest).
// aliveLeadIds é testado com `fetch` stubado (sem rede real).

import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aliveLeadIds, missingLeadIds, reconcileGuard, RECONCILE_MIN_ABS,
} from "./reconcile.ts";

const creds = { subdomain: "teste", token: "x" };

Deno.test("missingLeadIds - devolve só os locais que não vieram do Kommo", () => {
  const seen = new Set(["1", "2", "3"]);
  assertEquals(missingLeadIds(["1", "2", "4", "5"], seen), ["4", "5"]);
});

Deno.test("missingLeadIds - nada faltando devolve vazio", () => {
  assertEquals(missingLeadIds(["1", "2"], new Set(["1", "2", "9"])), []);
});

Deno.test("reconcileGuard - poucos leads passa", () => {
  assertEquals(reconcileGuard(7, 1406, false), null);
});

Deno.test("reconcileGuard - acima de 20% mas abaixo do mínimo absoluto passa (conta pequena)", () => {
  assertEquals(reconcileGuard(RECONCILE_MIN_ABS, 100, false), null);
});

Deno.test("reconcileGuard - acima de 20% e do mínimo absoluto bloqueia", () => {
  const r = reconcileGuard(400, 1406, false);
  assertMatch(r ?? "", /400 de 1406/);
  // a instrução de desbloqueio tem que citar o full (force_reconcile sozinho não reconcilia)
  assertMatch(r ?? "", /full: true, force_reconcile: true/);
});

Deno.test("reconcileGuard - abaixo de 20% mesmo com muitos leads passa", () => {
  assertEquals(reconcileGuard(200, 2486, false), null);
});

Deno.test("reconcileGuard - force libera o bloqueio", () => {
  assertEquals(reconcileGuard(400, 1406, true), null);
});

function stubFetch(aliveIds: Set<string>, calls: string[]) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const asked = [...new URL(url).searchParams.getAll("filter[id][]")];
    const found = asked.filter((id) => aliveIds.has(id)).map((id) => ({ id: Number(id) }));
    // Kommo devolve 204 quando nenhum lead bate no filtro
    if (!found.length) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response(JSON.stringify({ _embedded: { leads: found } }), { status: 200 }));
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

Deno.test("aliveLeadIds - separa vivos (vêm no filtro por id) de excluídos (204)", async () => {
  const calls: string[] = [];
  const restore = stubFetch(new Set(["10", "30"]), calls);
  try {
    const alive = await aliveLeadIds(creds, ["10", "20", "30", "40"]);
    assertEquals([...alive].sort(), ["10", "30"]);
    assertEquals(calls.length, 1);
  } finally {
    restore();
  }
});

Deno.test("aliveLeadIds - quebra em lotes", async () => {
  const calls: string[] = [];
  const restore = stubFetch(new Set(["1", "5"]), calls);
  try {
    const alive = await aliveLeadIds(creds, ["1", "2", "3", "4", "5"], 2);
    assertEquals([...alive].sort(), ["1", "5"]);
    assertEquals(calls.length, 3);
  } finally {
    restore();
  }
});

Deno.test("aliveLeadIds - lista vazia não chama o Kommo", async () => {
  const calls: string[] = [];
  const restore = stubFetch(new Set(), calls);
  try {
    assertEquals((await aliveLeadIds(creds, [])).size, 0);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});
