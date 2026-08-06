import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractCf, extractCfDate, extractCfValues, inferFunnelMapping, type KommoStatus } from "./pure.ts";

Deno.test("inferFunnelMapping - status 142 sempre vai pra venda_ganha, mesmo sem nome batendo", () => {
  const stages: KommoStatus[] = [{ id: "142", name: "Qualquer nome" }];
  const out = inferFunnelMapping(stages);
  assertEquals(out.venda_ganha, ["142"]);
});

Deno.test("inferFunnelMapping - status 143 (perdido) nunca entra em nenhum bucket", () => {
  const stages: KommoStatus[] = [{ id: "143", name: "Perdido" }];
  const out = inferFunnelMapping(stages);
  assertEquals(out.contato_inicial, []);
  assertEquals(out.proposta_enviada, []);
  assertEquals(out.fechamento, []);
  // 142 sempre é adicionado a venda_ganha mesmo que não esteja na lista de stages.
  assertEquals(out.venda_ganha, ["142"]);
});

Deno.test("inferFunnelMapping - classifica por palavras-chave no nome da etapa", () => {
  const stages: KommoStatus[] = [
    { id: "1", name: "Primeiro contato" },
    { id: "2", name: "Enviar orçamento" },
    { id: "3", name: "Negociação" },
    { id: "4", name: "Venda Ganha" },
  ];
  const out = inferFunnelMapping(stages);
  assertEquals(out.contato_inicial, ["1"]);
  assertEquals(out.proposta_enviada, ["2"]);
  assertEquals(out.fechamento, ["3"]);
  assertEquals(out.venda_ganha, ["4", "142"]);
});

Deno.test("inferFunnelMapping - achado: 'proposta enviada' no nome bate no regex de FECHAMENTO, não de proposta_enviada", () => {
  // Documenta o comportamento real (não é bug desta leva de testes corrigir):
  // o regex de fechamento inclui literalmente a frase "proposta enviada" como
  // um dos termos alternativos, então uma etapa chamada assim cai em
  // `fechamento`, não em `proposta_enviada` — mesmo contendo a palavra "proposta".
  const stages: KommoStatus[] = [{ id: "9", name: "Proposta enviada" }];
  const out = inferFunnelMapping(stages);
  assertEquals(out.fechamento, ["9"]);
  assertEquals(out.proposta_enviada, []);
});

Deno.test("inferFunnelMapping - '142' não duplica se já presente na lista de stages", () => {
  const stages: KommoStatus[] = [{ id: "142", name: "Venda ganha" }];
  const out = inferFunnelMapping(stages);
  assertEquals(out.venda_ganha, ["142"]);
});

const cfv = [
  { field_code: "PHONE", field_id: 10, values: [{ value: "11999999999" }] },
  { field_code: "MULTI", field_id: 20, values: [{ value: "a" }, { value: "b" }, { value: "" }] },
];

Deno.test("extractCf - encontra por field_code", () => {
  assertEquals(extractCf(cfv, "PHONE"), "11999999999");
});

Deno.test("extractCf - encontra por field_id (string)", () => {
  assertEquals(extractCf(cfv, "10"), "11999999999");
});

Deno.test("extractCf - código inexistente retorna null", () => {
  assertEquals(extractCf(cfv, "NAO_EXISTE"), null);
});

Deno.test("extractCf - codeOrId nulo retorna null", () => {
  assertEquals(extractCf(cfv, null), null);
});

Deno.test("extractCf - múltiplos valores são juntados com vírgula, vazios filtrados", () => {
  assertEquals(extractCf(cfv, "MULTI"), "a, b");
});

Deno.test("extractCfValues - devolve cada valor individualmente", () => {
  assertEquals(extractCfValues(cfv, "MULTI"), ["a", "b"]);
});

Deno.test("extractCfValues - campo não encontrado devolve array vazio", () => {
  assertEquals(extractCfValues(cfv, "NAO_EXISTE"), []);
});

Deno.test("extractCfDate - valor numérico é interpretado como unix segundos (Kommo)", () => {
  const cfvDate = [{ field_code: "DATA_VENDA", values: [{ value: "1735689600" }] }]; // 2025-01-01T00:00:00Z
  const d = extractCfDate(cfvDate, "DATA_VENDA");
  assertEquals(d?.toISOString(), "2025-01-01T00:00:00.000Z");
});

Deno.test("extractCfDate - valor não numérico tenta parsear como data", () => {
  const cfvDate = [{ field_code: "DATA_VENDA", values: [{ value: "2025-06-15" }] }];
  const d = extractCfDate(cfvDate, "DATA_VENDA");
  assertEquals(d !== null, true);
});

Deno.test("extractCfDate - sem valores devolve null", () => {
  assertEquals(extractCfDate(cfv, "NAO_EXISTE"), null);
});
