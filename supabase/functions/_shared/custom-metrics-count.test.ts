import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStageOrder, buildLostBeforeMap, oldestEventDate, leadReachedCascata, countCascata,
  isFieldRef, splitMetricRefs, matchesFieldRef,
  type CascataLead, type RawStageEvent, type StageOrderMap, type MetricRef,
} from "./custom-metrics-count.ts";

const stageOrder: StageOrderMap = buildStageOrder([
  {
    kommo_id: "P1",
    statuses: [
      { id: "10", sort: 10 }, { id: "20", sort: 20 }, { id: "30", sort: 30 },
      { id: "142", sort: 10000 }, { id: "143", sort: 11000 },
    ],
  },
]);

Deno.test("buildStageOrder - resolve sort por pipeline+status", () => {
  assertEquals(stageOrder.get("P1")?.get("20"), 20);
  assertEquals(stageOrder.get("P2"), undefined);
});

Deno.test("leadReachedCascata - conta lead atualmente na etapa alvo", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "20" };
  assertEquals(leadReachedCascata(l, [{ pipelineId: "P1", statusId: "20" }], stageOrder, new Map()), true);
});

Deno.test("leadReachedCascata - conta lead que já avançou além da etapa alvo", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "30" };
  assertEquals(leadReachedCascata(l, [{ pipelineId: "P1", statusId: "20" }], stageOrder, new Map()), true);
});

Deno.test("leadReachedCascata - não conta lead que ainda não chegou na etapa alvo", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "10" };
  assertEquals(leadReachedCascata(l, [{ pipelineId: "P1", statusId: "20" }], stageOrder, new Map()), false);
});

Deno.test("leadReachedCascata - lead perdido sem before_status conhecido não conta", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "143" };
  assertEquals(leadReachedCascata(l, [{ pipelineId: "P1", statusId: "20" }], stageOrder, new Map()), false);
});

Deno.test("leadReachedCascata - lead perdido usa a etapa de onde veio (lostBeforeByLead)", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "143" };
  const lostBefore = new Map([["1", "30"]]); // perdeu vindo da etapa 30 (além da alvo 20)
  assertEquals(leadReachedCascata(l, [{ pipelineId: "P1", statusId: "20" }], stageOrder, lostBefore), true);
});

Deno.test("leadReachedCascata - ref apontando pro próprio Perdido (143) bate direto num lead perdido", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "143" };
  // Sem lostBeforeByLead nenhum — não devia importar, a ref É o 143.
  assertEquals(leadReachedCascata(l, [{ pipelineId: "P1", statusId: "143" }], stageOrder, new Map()), true);
});

Deno.test("leadReachedCascata - ref pro Perdido não bate num lead que não está perdido", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "20" };
  assertEquals(leadReachedCascata(l, [{ pipelineId: "P1", statusId: "143" }], stageOrder, new Map()), false);
});

Deno.test("leadReachedCascata - refs de outro pipeline não contam (sem match de funil)", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "30" };
  assertEquals(leadReachedCascata(l, [{ pipelineId: "P2", statusId: "20" }], stageOrder, new Map()), false);
});

Deno.test("leadReachedCascata - refs vazio devolve false sem iterar", () => {
  const l: CascataLead = { kommo_id: "1", pipeline_id: "P1", status_id: "30" };
  assertEquals(leadReachedCascata(l, [], stageOrder, new Map()), false);
});

Deno.test("countCascata - soma leadReachedCascata pra uma lista de leads", () => {
  const leads: CascataLead[] = [
    { kommo_id: "1", pipeline_id: "P1", status_id: "30" }, // avançou além
    { kommo_id: "2", pipeline_id: "P1", status_id: "10" }, // não chegou
    { kommo_id: "3", pipeline_id: "P1", status_id: "20" }, // está na etapa
  ];
  assertEquals(countCascata(leads, [{ pipelineId: "P1", statusId: "20" }], stageOrder, new Map()), 2);
});

Deno.test("buildLostBeforeMap - pega o before do evento de perda mais recente por lead", () => {
  const events: RawStageEvent[] = [
    { leadId: "1", before: "10", after: "20", changedAt: 100 },
    { leadId: "1", before: "20", after: "143", changedAt: 200 }, // perdeu vindo de 20
    { leadId: "1", before: "30", after: "143", changedAt: 300 }, // perda mais recente: vindo de 30
    { leadId: "2", before: "10", after: "20", changedAt: 100 }, // nunca perdeu
  ];
  const out = buildLostBeforeMap(events);
  assertEquals(out.get("1"), "30");
  assertEquals(out.get("2"), undefined);
});

Deno.test("oldestEventDate - devolve a data do evento mais antigo", () => {
  const events = [{ changedAt: 300 }, { changedAt: 100 }, { changedAt: 200 }];
  assertEquals(oldestEventDate(events), new Date(100).toISOString());
});

Deno.test("oldestEventDate - lista vazia devolve null", () => {
  assertEquals(oldestEventDate([]), null);
});

// ===== Lado de campo personalizado =====

Deno.test("isFieldRef - distingue StageRef de FieldRef pela presença de fieldId", () => {
  assertEquals(isFieldRef({ pipelineId: "P1", statusId: "20" }), false);
  assertEquals(isFieldRef({ fieldId: "nao_compareceu" }), true);
});

Deno.test("splitMetricRefs - separa etapa e campo, preserva ordem dentro de cada grupo", () => {
  const refs: MetricRef[] = [
    { pipelineId: "P1", statusId: "20" },
    { fieldId: "nao_compareceu" },
    { pipelineId: "P1", statusId: "30" },
  ];
  const { stageRefs, fieldRefs } = splitMetricRefs(refs);
  assertEquals(stageRefs, [{ pipelineId: "P1", statusId: "20" }, { pipelineId: "P1", statusId: "30" }]);
  assertEquals(fieldRefs, [{ fieldId: "nao_compareceu" }]);
});

// Shape real de kommo.leads.custom_fields (jsonb) — array de
// {field_id, field_code, values: [{value}]}, igual ao que extractCf lê.
const cfMarked = [{ field_id: "999", field_code: "nao_compareceu", values: [{ value: "Sim" }] }];
const cfUnmarked: unknown[] = []; // checkbox desmarcado: campo ausente do array (suposição documentada no plano)
const cfMultiselect = [{ field_id: "888", field_code: "origem", values: [{ value: "Instagram" }, { value: "Facebook" }] }];

Deno.test("matchesFieldRef - sem value: bate em qualquer valor preenchido", () => {
  assertEquals(matchesFieldRef(cfMarked, { fieldId: "nao_compareceu" }), true);
  assertEquals(matchesFieldRef(cfUnmarked, { fieldId: "nao_compareceu" }), false);
});

Deno.test("matchesFieldRef - com value: só bate no valor exato", () => {
  assertEquals(matchesFieldRef(cfMarked, { fieldId: "nao_compareceu", value: "Sim" }), true);
  assertEquals(matchesFieldRef(cfMarked, { fieldId: "nao_compareceu", value: "Não" }), false);
});

Deno.test("matchesFieldRef - multiselect: bate se o valor pedido está entre os marcados", () => {
  assertEquals(matchesFieldRef(cfMultiselect, { fieldId: "origem", value: "Facebook" }), true);
  assertEquals(matchesFieldRef(cfMultiselect, { fieldId: "origem", value: "Google" }), false);
  assertEquals(matchesFieldRef(cfMultiselect, { fieldId: "origem" }), true); // sem value: qualquer marcado
});

Deno.test("matchesFieldRef - campo inexistente no lead não bate", () => {
  assertEquals(matchesFieldRef(cfMarked, { fieldId: "outro_campo" }), false);
});

// Combinação etapa OU campo — mesma lógica de countMetricSide (kommo-dashboard/
// index.ts) e leadReachedMetricSide (kommo-report-snapshot/index.ts), replicada
// aqui como teste de integração das peças, já que a função em si é local a
// cada edge function (não exportada do módulo compartilhado).
function leadReachedSide(
  lead: CascataLead & { custom_fields?: unknown },
  refs: MetricRef[],
  order: StageOrderMap,
  lostBefore: Map<string, string>,
): boolean {
  const { stageRefs, fieldRefs } = splitMetricRefs(refs);
  const stageMatch = stageRefs.length > 0 && leadReachedCascata(lead, stageRefs, order, lostBefore);
  const fieldMatch = fieldRefs.some((r) => matchesFieldRef(lead.custom_fields, r));
  return stageMatch || fieldMatch;
}

Deno.test("leadReachedSide - lead bate só pela etapa (sem campo marcado)", () => {
  const l = { kommo_id: "1", pipeline_id: "P1", status_id: "30", custom_fields: cfUnmarked };
  const refs: MetricRef[] = [{ pipelineId: "P1", statusId: "20" }, { fieldId: "nao_compareceu" }];
  assertEquals(leadReachedSide(l, refs, stageOrder, new Map()), true);
});

Deno.test("leadReachedSide - lead bate só pelo campo (etapa ainda não alcançada)", () => {
  const l = { kommo_id: "1", pipeline_id: "P1", status_id: "10", custom_fields: cfMarked };
  const refs: MetricRef[] = [{ pipelineId: "P1", statusId: "20" }, { fieldId: "nao_compareceu" }];
  assertEquals(leadReachedSide(l, refs, stageOrder, new Map()), true);
});

Deno.test("leadReachedSide - lead não bate em nenhum dos dois", () => {
  const l = { kommo_id: "1", pipeline_id: "P1", status_id: "10", custom_fields: cfUnmarked };
  const refs: MetricRef[] = [{ pipelineId: "P1", statusId: "20" }, { fieldId: "nao_compareceu" }];
  assertEquals(leadReachedSide(l, refs, stageOrder, new Map()), false);
});

// ===== Regressão: numerador e denominador contam pela MESMA régua =====
// A % de uma Métrica Personalizada divide dois lados. Se um lado conta "passou
// por" (cascata/histórico) e o outro "está agora em", a divisão mistura duas
// fotos tiradas em critérios diferentes e a % destoa da contagem manual — foi a
// CAUSA RAIZ, DUAS VEZES (ver CLAUDE.md, "Métricas Personalizadas — semântica do
// numerador"). Correção: os dois lados passam por countMetricSide(refs, mode)
// (kommo-dashboard) / leadReachedMetricSide (kommo-report-snapshot) — a MESMA
// função, só mudando o conjunto de refs. `leadReachedSide` acima replica essa
// função; estes testes travam a propriedade que ela garante.

Deno.test("regressão — mesma ref nos dois lados => mesma contagem (função é side-agnóstica)", () => {
  const leads: CascataLead[] = [
    { kommo_id: "1", pipeline_id: "P1", status_id: "10" },
    { kommo_id: "2", pipeline_id: "P1", status_id: "20" },
    { kommo_id: "3", pipeline_id: "P1", status_id: "30" },
  ];
  const refs: MetricRef[] = [{ pipelineId: "P1", statusId: "20" }];
  const asNumerator = leads.filter((l) => leadReachedSide(l, refs, stageOrder, new Map())).length;
  const asDenominator = leads.filter((l) => leadReachedSide(l, refs, stageOrder, new Map())).length;
  assertEquals(asNumerator, asDenominator);
});

Deno.test("regressão — denominador amplo + numerador recorte, MESMA régua => num <= den (ratio <= 100%)", () => {
  // Cascata é monótona: quem alcançou "30" também alcançou "10". Com a mesma
  // função nos dois lados, o numerador (recorte "30") nunca passa do
  // denominador (base "10"). Se o denominador voltasse a contar "está agora em
  // 10" (o bug), ele daria 1 e o numerador 1 — ou pior, num > den.
  const leads: CascataLead[] = [
    { kommo_id: "1", pipeline_id: "P1", status_id: "10" }, // só chegou em 10
    { kommo_id: "2", pipeline_id: "P1", status_id: "20" }, // passou por 10, está em 20
    { kommo_id: "3", pipeline_id: "P1", status_id: "30" }, // passou por 10 e 20, está em 30
  ];
  const denRefs: MetricRef[] = [{ pipelineId: "P1", statusId: "10" }];
  const numRefs: MetricRef[] = [{ pipelineId: "P1", statusId: "30" }];
  const den = leads.filter((l) => leadReachedSide(l, denRefs, stageOrder, new Map())).length;
  const num = leads.filter((l) => leadReachedSide(l, numRefs, stageOrder, new Map())).length;
  assertEquals(den, 3);
  assertEquals(num, 1);
  assertEquals(num <= den, true);
});
