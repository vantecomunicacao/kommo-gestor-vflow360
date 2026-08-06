import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractCf, extractCfDate, extractCfValues, inferFunnelMapping, type KommoStatus,
  safeRate, isWonLead, stageBucket, buildDist, cycleDays, computeTimePerStage,
  countCurrentlyIn, countPassedThrough,
  type Bucket, type BucketResolver, type DashboardLead, type StageEvent,
} from "./pure.ts";

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

// ============================================================================
// Golden tests (fixtures sintéticas) das funções extraídas das closures do
// serve() — segunda leva da Fase 4. Funil fictício "P1": status_id "10"
// contato_inicial, "20" proposta_enviada, "30" fechamento, "142" venda_ganha
// (won de sistema do Kommo), "143" perdido (nunca entra em bucket).
// ============================================================================

const testBucketOf: BucketResolver = (_pipelineId, statusId) => {
  const map: Record<string, Bucket> = { "10": "contato_inicial", "20": "proposta_enviada", "30": "fechamento", "142": "venda_ganha" };
  return statusId ? (map[statusId] ?? null) : null;
};

function lead(overrides: Partial<DashboardLead> & { kommo_id: string }): DashboardLead {
  return { pipeline_id: "P1", status_id: "10", status: "open", ...overrides };
}

Deno.test("safeRate - divisão normal", () => {
  assertEquals(safeRate(5, 10), 50);
});

Deno.test("safeRate - denominador zero devolve 0 (não Infinity/NaN)", () => {
  assertEquals(safeRate(5, 0), 0);
});

Deno.test("isWonLead - true quando status literal é 'won', mesmo sem bucket mapeado", () => {
  assertEquals(isWonLead(lead({ kommo_id: "1", status: "won", status_id: "999" }), testBucketOf), true);
});

Deno.test("isWonLead - true quando o bucket da etapa atual é venda_ganha", () => {
  assertEquals(isWonLead(lead({ kommo_id: "1", status: "open", status_id: "142" }), testBucketOf), true);
});

Deno.test("isWonLead - false em etapa comum", () => {
  assertEquals(isWonLead(lead({ kommo_id: "1", status: "open", status_id: "10" }), testBucketOf), false);
});

Deno.test("stageBucket - resolve etapa comum", () => {
  assertEquals(stageBucket("P1", "20", testBucketOf), "proposta_enviada");
});

Deno.test("stageBucket - status perdido (143) nunca cai em bucket", () => {
  assertEquals(stageBucket("P1", "143", testBucketOf), null);
});

Deno.test("buildDist - distribui, ordena por contagem e calcula fillRate", () => {
  const subset = [lead({ kommo_id: "1" }), lead({ kommo_id: "2" }), lead({ kommo_id: "3" }), lead({ kommo_id: "4" })];
  const values = ["a", "a", "b", "b"];
  let i = 0;
  const result = buildDist(() => values[i++], subset);
  assertEquals(result.fillRate, 100);
  assertEquals(result.distribution, [
    { name: "a", count: 2, percentage: 50 },
    { name: "b", count: 2, percentage: 50 },
  ]);
});

Deno.test("buildDist - valores nulos não contam pro fillRate", () => {
  const subset = [lead({ kommo_id: "1" }), lead({ kommo_id: "2" })];
  const result = buildDist(() => null, subset);
  assertEquals(result.fillRate, 0);
  assertEquals(result.distribution, []);
});

Deno.test("cycleDays - média em dias, ignora leads sem closed_at", () => {
  const subset: DashboardLead[] = [
    lead({ kommo_id: "1", kommo_created_at: "2025-01-01T00:00:00Z", closed_at: "2025-01-06T00:00:00Z" }), // 5 dias
    lead({ kommo_id: "2", kommo_created_at: "2025-01-01T00:00:00Z", closed_at: "2025-01-11T00:00:00Z" }), // 10 dias
    lead({ kommo_id: "3", kommo_created_at: "2025-01-01T00:00:00Z" }), // sem closed_at — ignorado
  ];
  const result = cycleDays(subset);
  assertEquals(result, { days: 7.5, sampleSize: 2 });
});

Deno.test("cycleDays - subset vazio devolve zeros", () => {
  assertEquals(cycleDays([]), { days: 0, sampleSize: 0 });
});

Deno.test("computeTimePerStage - soma o tempo dos trechos FECHADOS (o trecho aberto no bucket venda_ganha nunca é contado)", () => {
  const created = new Date("2025-01-01T00:00:00Z").getTime();
  const t1 = created + 10 * 3_600_000; // 10h em "contato_inicial"
  const t2 = t1 + 5 * 3_600_000; // 5h em "proposta_enviada", depois vira venda_ganha (aberto, excluído)
  const leads: DashboardLead[] = [
    lead({ kommo_id: "1", kommo_created_at: "2025-01-01T00:00:00Z" }),
    // sem eventos, etapa não mapeada (bucket null) — excluído independente de `now`.
    lead({ kommo_id: "2", status_id: "999", kommo_created_at: "2025-01-01T00:00:00Z" }),
  ];
  const eventsByLead = new Map<string, StageEvent[]>([
    ["1", [{ before: "10", after: "20", t: t1 }, { before: "20", after: "142", t: t2 }]],
  ]);
  const result = computeTimePerStage(leads, eventsByLead, testBucketOf);
  assertEquals(result, { contatoInicial: 10, propostaEnviada: 5, fechamento: 0 });
});

Deno.test("countCurrentlyIn - conta só quem está ATUALMENTE no par funil+etapa", () => {
  const leads: DashboardLead[] = [
    lead({ kommo_id: "1", pipeline_id: "P1", status_id: "20" }),
    lead({ kommo_id: "2", pipeline_id: "P1", status_id: "30" }),
  ];
  assertEquals(countCurrentlyIn(leads, [{ pipelineId: "P1", statusId: "20" }]), 1);
});

Deno.test("countPassedThrough - conta quem está atualmente na etapa OU passou por ela no histórico", () => {
  const leads: DashboardLead[] = [lead({ kommo_id: "1", pipeline_id: "P1", status_id: "30" })];
  const eventsByLead = new Map<string, StageEvent[]>([
    ["1", [{ before: "10", after: "20", t: 100 }]],
  ]);
  assertEquals(countPassedThrough(leads, eventsByLead, [{ pipelineId: "P1", statusId: "20" }]), 1);
  assertEquals(countPassedThrough(leads, eventsByLead, [{ pipelineId: "P1", statusId: "999" }]), 0);
});

Deno.test("countPassedThrough - refs vazio devolve 0 sem iterar", () => {
  assertEquals(countPassedThrough([lead({ kommo_id: "1" })], new Map(), []), 0);
});
