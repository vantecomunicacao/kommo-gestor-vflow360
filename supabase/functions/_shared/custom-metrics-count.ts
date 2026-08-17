// Contagem "cascata" das Métricas Personalizadas (kommo.dashboard_settings.
// custom_metrics) — usado tanto por kommo-dashboard (ao vivo) quanto por
// kommo-report-snapshot (safras mensais), pra as duas telas não divergirem
// pra mesma métrica. Mesmo padrão de módulo compartilhado de kommo-funnel.ts.
//
// Por quê: a outra opção ("histórico", já existente em cada function —
// countPassedThrough no kommo-dashboard, leadReachedAnyOf no
// kommo-report-snapshot) depende de kommo.lead_stage_events, alimentado pela
// API de eventos do Kommo — que, investigando o caso real do workspace
// "ConsulttAgro Prime" (2026-08-17), só retém histórico por ~18-20 dias
// (nenhum lead cuja última mudança foi antes de 30/07/2026 tinha QUALQUER
// evento salvo). Não é bug do sync — é teto da fonte, sem como recuperar.
//
// "Cascata" evita essa dependência: conta pela posição ATUAL do lead + ordem
// das etapas do funil (mesma técnica de "Visão Geral - Funil de Passagem"),
// então funciona mesmo pra mudanças de etapa antigas. A única exceção é lead
// PERDIDO — aí usamos o `before_status_id` do evento de perda (se ainda
// estiver dentro da janela de retenção) pra saber de qual etapa ele veio,
// senão a contagem ficaria pessimista pra qualquer etapa intermediária.

import { extractCfValues } from "./custom-fields.ts";

export interface StageRef { pipelineId: string; statusId: string; }

// ===== Lado de CAMPO PERSONALIZADO (numerador/denominador podem misturar
// etapa e campo, "OU" entre tudo) =====
//
// Por quê: contas sem uma etapa própria pra algo (ex.: "não compareceu")
// marcam um campo personalizado no lead em vez de mover de etapa. Um campo
// marcado não depende de posição no funil (não sofre da limitação da cascata
// com reentrada) nem de histórico de eventos (não sofre da janela curta do
// modo histórico) — é só o valor ATUAL do lead.

export interface FieldRef {
  fieldId: string;
  /** Ausente/vazio = "campo preenchido" (qualquer valor conta). Presente = precisa bater exatamente. */
  value?: string;
}
export type MetricRef = StageRef | FieldRef;
export const isFieldRef = (r: MetricRef): r is FieldRef => "fieldId" in r;

export function splitMetricRefs(refs: MetricRef[]): { stageRefs: StageRef[]; fieldRefs: FieldRef[] } {
  const stageRefs: StageRef[] = [];
  const fieldRefs: FieldRef[] = [];
  for (const r of refs) if (isFieldRef(r)) fieldRefs.push(r); else stageRefs.push(r);
  return { stageRefs, fieldRefs };
}

/**
 * value ausente → "preenchido" (qualquer valor). value presente → precisa
 * bater com um dos valores individuais do campo — usa extractCfValues (não
 * extractCf, que junta tudo numa string só) pra funcionar certo tanto em
 * campo de valor único quanto multiselect (várias opções marcadas).
 */
export function matchesFieldRef(customFields: unknown, ref: FieldRef): boolean {
  const values = extractCfValues(customFields, ref.fieldId);
  return ref.value ? values.includes(ref.value) : values.length > 0;
}

/** Só os campos usados aqui de KommoStatus (id.pure.ts tem a versão completa). */
export interface KommoStatusLite { id: string; sort?: number; }

/** pipelineId -> (statusId -> sort). */
export type StageOrderMap = Map<string, Map<string, number>>;

export function buildStageOrder(
  pipelines: Array<{ kommo_id: string; statuses: KommoStatusLite[] | null }>,
): StageOrderMap {
  const out: StageOrderMap = new Map();
  for (const p of pipelines) {
    const byStatus = new Map<string, number>();
    for (const s of p.statuses || []) {
      if (s.id == null) continue;
      byStatus.set(String(s.id), typeof s.sort === "number" ? s.sort : 0);
    }
    out.set(p.kommo_id, byStatus);
  }
  return out;
}

/** Status de sistema "Perdido" do Kommo — mesmo id em todo funil. */
export const LOST_STATUS_ID = "143";

/** Evento de mudança de etapa, normalizado — mesmo shape lógico das duas functions. */
export interface RawStageEvent {
  leadId: string;
  before: string | null;
  after: string | null;
  changedAt: number; // epoch ms
}

/**
 * Pra cada lead que foi perdido, pega o `before` do evento de perda mais
 * recente — é a etapa "real" de onde ele veio, usada pela cascata pra não
 * tratar todo lead perdido como se nunca tivesse saído da 1ª etapa.
 */
export function buildLostBeforeMap(events: RawStageEvent[]): Map<string, string> {
  const latest = new Map<string, RawStageEvent>();
  for (const e of events) {
    if (e.after !== LOST_STATUS_ID || !e.before) continue;
    const cur = latest.get(e.leadId);
    if (!cur || e.changedAt > cur.changedAt) latest.set(e.leadId, e);
  }
  const out = new Map<string, string>();
  for (const [leadId, e] of latest) out.set(leadId, e.before as string);
  return out;
}

/** Data do evento mais antigo já sincronizado — usado pro aviso de "só enxerga desde X". */
export function oldestEventDate(events: Array<{ changedAt: number }>): string | null {
  let min: number | null = null;
  for (const e of events) if (min === null || e.changedAt < min) min = e.changedAt;
  return min === null ? null : new Date(min).toISOString();
}

/** Shape mínimo de lead que os dois callers já satisfazem estruturalmente. */
export interface CascataLead {
  kommo_id: string | number;
  pipeline_id: string | null;
  status_id: string | null;
}

/**
 * "Alcançou etapa X (ou além)": posição atual do lead (resolvida pelo pipeline
 * dele) tem sort >= sort da menor etapa-alvo no mesmo pipeline. Refs de outro
 * pipeline são ignoradas (mesma regra de escopo por funil das outras contagens).
 */
export function leadReachedCascata(
  lead: CascataLead,
  refs: StageRef[],
  stageOrder: StageOrderMap,
  lostBeforeByLead: Map<string, string>,
): boolean {
  if (refs.length === 0 || !lead.pipeline_id) return false;
  const relevantRefs = refs.filter((r) => r.pipelineId === lead.pipeline_id);
  if (relevantRefs.length === 0) return false;
  const orderForPipeline = stageOrder.get(lead.pipeline_id);
  if (!orderForPipeline) return false;

  // Lead perdido E a métrica quer exatamente "Perdido" (ex.: "quantos foram
  // perdidos"): bate direto. Sem esse caso especial, o passo abaixo troca
  // "143" pela etapa de origem antes de comparar sort — o que faria um lead
  // perdido NUNCA bater com uma ref que aponta pro próprio "143" (o sort dele
  // é o mais alto do funil, mas a comparação usaria o sort da etapa anterior).
  if (lead.status_id === LOST_STATUS_ID && relevantRefs.some((r) => r.statusId === LOST_STATUS_ID)) {
    return true;
  }

  let effectiveStatusId = lead.status_id;
  if (effectiveStatusId === LOST_STATUS_ID) {
    // Sem saber de onde o lead veio antes de perder, não dá pra posicioná-lo no
    // funil — "143" tem um sort artificialmente alto (status de sistema), então
    // cair nele por engano faria QUALQUER lead perdido contar pra QUALQUER etapa.
    const before = lostBeforeByLead.get(String(lead.kommo_id));
    if (!before) return false;
    effectiveStatusId = before;
  }
  if (!effectiveStatusId) return false;
  const currentSort = orderForPipeline.get(effectiveStatusId);
  if (currentSort == null) return false;

  let minTargetSort = Infinity;
  for (const r of relevantRefs) {
    const s = orderForPipeline.get(r.statusId);
    if (s != null && s < minTargetSort) minTargetSort = s;
  }
  if (!Number.isFinite(minTargetSort)) return false;
  return currentSort >= minTargetSort;
}

export function countCascata(
  leads: CascataLead[],
  refs: StageRef[],
  stageOrder: StageOrderMap,
  lostBeforeByLead: Map<string, string>,
): number {
  let n = 0;
  for (const l of leads) if (leadReachedCascata(l, refs, stageOrder, lostBeforeByLead)) n++;
  return n;
}
