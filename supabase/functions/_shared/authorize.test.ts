// Testes de authorize.ts — rodam via `deno test`, runner separado do vitest
// (que só enxerga src/). Cobre o que dá pra testar sem rede real: o caminho
// interno (x-internal-secret) inteiro, requireWorkspaceMember com um db
// mockado, e os early-returns que não chegam a chamar createClient/getClaims.
// O caminho "usuário" de authorizeWorkspace/resolveCallerIdentity que decodifica
// um JWT de verdade via getClaims/getUser NÃO está coberto aqui — exigiria rede
// real ou um refactor pra injetar o client, fora do escopo desta leva.

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeWorkspace, requireWorkspaceMember, resolveCallerIdentity, safeEqual, type KommoClient } from "./authorize.ts";

function mockDb(isMember: boolean): KommoClient {
  return {
    rpc: async () => ({ data: isMember, error: null }),
  } as unknown as KommoClient;
}

Deno.test("safeEqual - strings iguais retornam true", () => {
  assertEquals(safeEqual("segredo123", "segredo123"), true);
});

Deno.test("safeEqual - strings diferentes (mesmo tamanho) retornam false", () => {
  assertEquals(safeEqual("segredo123", "outro-vaLor"), false);
});

Deno.test("safeEqual - tamanhos diferentes retornam false", () => {
  assertEquals(safeEqual("curto", "um-valor-bem-mais-longo"), false);
});

Deno.test("requireWorkspaceMember - não lança quando é membro", async () => {
  await requireWorkspaceMember(mockDb(true), "user-1", "ws-1");
});

Deno.test("requireWorkspaceMember - lança Forbidden quando não é membro", async () => {
  await assertRejects(
    () => requireWorkspaceMember(mockDb(false), "user-1", "ws-1"),
    Error,
    "Forbidden: not a member of this workspace",
  );
});

Deno.test("resolveCallerIdentity - sem header Authorization devolve identidade vazia (sem tentar rede)", async () => {
  const req = new Request("https://example.com", { method: "POST" });
  const identity = await resolveCallerIdentity(req, "https://fake.supabase.co", "fake-anon-key");
  assertEquals(identity, { userId: undefined, userEmail: undefined });
});

Deno.test("authorizeWorkspace - sem Authorization e sem segredo interno configurado lança Missing authorization", async () => {
  const req = new Request("https://example.com", { method: "POST" });
  await assertRejects(
    () => authorizeWorkspace({
      req, db: mockDb(true), supabaseUrl: "https://fake.supabase.co", anonKey: "fake-anon-key", workspaceId: "ws-1",
    }),
    Error,
    "Missing authorization",
  );
});

Deno.test("authorizeWorkspace - caminho interno: segredo correto autoriza sem checar JWT/membership", async () => {
  Deno.env.set("INTERNAL_FUNCTION_SECRET", "segredo-de-teste");
  try {
    const req = new Request("https://example.com", {
      method: "POST",
      headers: { "x-internal-secret": "segredo-de-teste" },
    });
    // db com membership FALSA de propósito — não deveria nem ser consultado.
    const result = await authorizeWorkspace({
      req, db: mockDb(false),
      supabaseUrl: "https://fake.supabase.co", anonKey: "fake-anon-key", workspaceId: "ws-1",
    });
    assertEquals(result, { userId: null, via: "internal" });
  } finally {
    Deno.env.delete("INTERNAL_FUNCTION_SECRET");
  }
});

Deno.test("authorizeWorkspace - caminho interno: segredo errado NÃO autoriza (nunca autoriza por segredo vazio nem por valor incorreto)", async () => {
  Deno.env.set("INTERNAL_FUNCTION_SECRET", "segredo-de-teste");
  try {
    const req = new Request("https://example.com", {
      method: "POST",
      headers: { "x-internal-secret": "segredo-errado" },
    });
    await assertRejects(
      () => authorizeWorkspace({
        req, db: mockDb(true), supabaseUrl: "https://fake.supabase.co", anonKey: "fake-anon-key", workspaceId: "ws-1",
      }),
      Error,
      "Missing authorization",
    );
  } finally {
    Deno.env.delete("INTERNAL_FUNCTION_SECRET");
  }
});
