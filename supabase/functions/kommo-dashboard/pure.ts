// Funções puras do kommo-dashboard, extraídas pra um arquivo sem `serve()` (ou
// qualquer outro efeito colateral no nível do módulo) de propósito: importar
// index.ts pra testar essas funções executaria o handler HTTP inteiro. Extração
// mecânica — mesmo código, sem mudança de lógica (Fase 4 do plano de
// remediação, 2026-08). Testadas em pure.test.ts.

export type Bucket = "contato_inicial" | "qualificando" | "proposta_enviada" | "fechamento" | "venda_ganha";

export interface KommoStatus { id: string; name: string; sort?: number; type?: number; }

/**
 * Infere a fase do funil (Bucket) pelo NOME da etapa quando não há mapeamento
 * configurado (`kommo.dashboard_settings.funnel_stage_mapping`) — ver uso em
 * `bucketOf`/`fallbackByStage` no handler (index.ts).
 */
export function inferFunnelMapping(stages: KommoStatus[]): Record<Bucket, string[]> {
  const out: Record<Bucket, string[]> = { contato_inicial: [], qualificando: [], proposta_enviada: [], fechamento: [], venda_ganha: [] };
  for (const s of stages) {
    const id = String(s.id);
    if (id === "142") { out.venda_ganha.push(id); continue; }
    if (id === "143") continue; // perdido nunca entra no funil
    const n = (s.name || "").toLowerCase();
    if (/(ganho|ganha|won|venda)/.test(n)) out.venda_ganha.push(id);
    else if (/(fechamento|closing|negocia|proposta enviada)/.test(n)) out.fechamento.push(id);
    else if (/(proposta|proposal|enviar|oferta|reuni)/.test(n)) out.proposta_enviada.push(id);
    else if (/(qualific|triagem)/.test(n)) out.qualificando.push(id);
    else out.contato_inicial.push(id);
  }
  if (!out.venda_ganha.includes("142")) out.venda_ganha.push("142");
  return out;
}

/** Item de `custom_fields` como gravado pelo kommo-sync (jsonb, sem schema fixo). */
interface CustomFieldRow {
  field_code?: string | number;
  field_id?: string | number;
  values?: Array<{ value?: unknown }>;
}

function asCustomFieldRows(cfv: unknown): CustomFieldRow[] {
  return Array.isArray(cfv) ? (cfv as CustomFieldRow[]) : [];
}

/** Extrai valor de um custom field de lead (array custom_fields_values) por code/id. */
export function extractCf(cfv: unknown, codeOrId: string | null): string | null {
  if (!codeOrId) return null;
  for (const f of asCustomFieldRows(cfv)) {
    if (String(f?.field_code ?? "") === codeOrId || String(f?.field_id ?? "") === codeOrId) {
      const vals = (f?.values ?? []).map((v) => v?.value).filter((v) => v != null && String(v).trim() !== "");
      return vals.length ? vals.join(", ") : null;
    }
  }
  return null;
}

/** Valor de um custom field do tipo DATA como Date (Kommo grava unix em segundos). */
export function extractCfDate(cfv: unknown, codeOrId: string | null): Date | null {
  const vals = extractCfValues(cfv, codeOrId);
  if (!vals.length) return null;
  const n = Number(vals[0]);
  if (!Number.isFinite(n)) {
    const d = new Date(vals[0]);
    return isNaN(d.getTime()) ? null : d;
  }
  // unix em segundos (Kommo) → ms
  return new Date(n * 1000);
}

/** Como extractCf, mas devolve cada valor individualmente (p/ multiselect e distribuição). */
export function extractCfValues(cfv: unknown, codeOrId: string | null): string[] {
  if (!codeOrId) return [];
  for (const f of asCustomFieldRows(cfv)) {
    if (String(f?.field_code ?? "") === codeOrId || String(f?.field_id ?? "") === codeOrId) {
      return (f?.values ?? [])
        .map((v) => v?.value)
        .filter((v) => v != null && String(v).trim() !== "")
        .map((v) => String(v));
    }
  }
  return [];
}

// ============================================================================
// Segunda leva de extração (Fase 4): funções que eram closures dentro do
// serve() em index.ts, capturando `leads`/`eventsByLead`/`bucketOf` do escopo
// externo. Aqui os mesmos dados viram parâmetros explícitos — mesma lógica,
// sem mudança de comportamento. Testadas com fixtures sintéticas em
// pure.test.ts (não dá pra rodar contra dado real sem mockar todo o client
// Supabase, fora do escopo desta leva — ver CLAUDE.md).
// ============================================================================

export const DAY_MS = 86_400_000;

/** Formato das linhas de kommo.leads usadas pelos cálculos abaixo. */
export interface DashboardLead {
  kommo_id: string | number;
  name?: string | null;
  pipeline_id: string | null;
  status_id: string | null;
  status: string;
  price?: number | null;
  responsible_user_id?: string | null;
  loss_reason_id?: string | null;
  custom_fields?: unknown;
  kommo_created_at?: string | null;
  kommo_updated_at?: string | null;
  closed_at?: string | null;
  closest_task_at?: string | null;
  contact_name?: string | null;
}

/** Evento de mudança de etapa, já normalizado (ver eventsByLead em index.ts). */
export interface StageEvent {
  before: string | null;
  after: string | null;
  t: number;
}

/** Mesma assinatura de `buildBucketResolver` (_shared/kommo-funnel.ts). */
export type BucketResolver = (
  pipelineId: string | null | undefined,
  statusId: string | null | undefined,
) => Bucket | null;

export function safeRate(a: number, b: number): number {
  return b > 0 ? (a / b) * 100 : 0;
}

/** A fase depende do PAR funil+etapa: `142`/`143` repetem em todos os funis. */
export function stageBucket(pipelineId: string | null, statusId: string | null, bucketOf: BucketResolver): Bucket | null {
  return bucketOf(pipelineId, statusId) as Bucket | null;
}

/**
 * Ganho = status de sistema do Kommo (`won`, status_id 142) OU etapa mapeada
 * como "Venda Ganha" NAQUELE funil (não um `add("142")` global — 142 é outra
 * coisa em alguns funis, ex. "Cirurgia Realizada").
 */
export function isWonLead(l: Pick<DashboardLead, "status" | "pipeline_id" | "status_id">, bucketOf: BucketResolver): boolean {
  return l.status === "won" || bucketOf(l.pipeline_id, l.status_id) === "venda_ganha";
}

export interface Distribution {
  distribution: Array<{ name: string; count: number; percentage: number }>;
  fillRate: number;
}

export function buildDist(getter: (l: DashboardLead) => string | null, subset: DashboardLead[]): Distribution {
  const m = new Map<string, number>(); let filled = 0;
  for (const l of subset) { const v = getter(l); if (v) { filled++; m.set(v, (m.get(v) || 0) + 1); } }
  const distribution = Array.from(m.entries()).map(([name, count]) => ({ name, count, percentage: safeRate(count, filled) })).sort((a, b) => b.count - a.count);
  return { distribution, fillRate: safeRate(filled, subset.length || 0) };
}

export function cycleDays(subset: DashboardLead[]): { days: number; sampleSize: number } {
  let total = 0, n = 0;
  for (const l of subset) {
    if (!l.kommo_created_at || !l.closed_at) continue;
    const ms = new Date(l.closed_at).getTime() - new Date(l.kommo_created_at).getTime();
    if (ms < 0) continue; total += ms; n++;
  }
  return n === 0 ? { days: 0, sampleSize: 0 } : { days: Math.round((total / n / DAY_MS) * 10) / 10, sampleSize: n };
}

/**
 * Tempo médio (em horas) por fase do funil, a partir do histórico de eventos.
 * Reconstrói os trechos (status, entrada, saída) de cada lead usando
 * created_at + eventos de mudança de etapa.
 */
export function computeTimePerStage(
  leads: DashboardLead[],
  eventsByLead: Map<string, StageEvent[]>,
  bucketOf: BucketResolver,
): { contatoInicial: number; qualificando: number; propostaEnviada: number; fechamento: number } {
  const acc: Record<Exclude<Bucket, "venda_ganha">, { sum: number; n: number }> = {
    contato_inicial: { sum: 0, n: 0 }, qualificando: { sum: 0, n: 0 }, proposta_enviada: { sum: 0, n: 0 }, fechamento: { sum: 0, n: 0 },
  };
  const now = Date.now();
  for (const l of leads) {
    const evs = (eventsByLead.get(String(l.kommo_id)) || []).slice().sort((a, b) => a.t - b.t);
    const created = l.kommo_created_at ? new Date(l.kommo_created_at).getTime() : null;
    const segs: Array<[string | null, number, number]> = [];
    if (evs.length === 0) {
      if (created != null) segs.push([l.status_id, created, now]);
    } else {
      if (created != null && evs[0].before) segs.push([evs[0].before, created, evs[0].t]);
      for (let i = 0; i < evs.length; i++) {
        segs.push([evs[i].after, evs[i].t, i + 1 < evs.length ? evs[i + 1].t : now]);
      }
    }
    for (const [status, enter, exit] of segs) {
      if (!status || exit < enter || status === "143") continue;
      const b = stageBucket(l.pipeline_id, status, bucketOf);
      if (b && b !== "venda_ganha") { acc[b].sum += (exit - enter); acc[b].n++; }
    }
  }
  // O componente do front formata em HORAS (depois converte para "Xd Yh").
  const toHours = (o: { sum: number; n: number }) => (o.n ? Math.round(o.sum / o.n / 3_600_000) : 0);
  return {
    contatoInicial: toHours(acc.contato_inicial),
    qualificando: toHours(acc.qualificando),
    propostaEnviada: toHours(acc.proposta_enviada),
    fechamento: toHours(acc.fechamento),
  };
}

/** "Está em": lead cujo status ATUAL é uma das etapas configuradas (par funil+etapa). */
export function countCurrentlyIn(leads: DashboardLead[], refs: { pipelineId: string; statusId: string }[]): number {
  const keys = new Set(refs.map((r) => `${r.pipelineId}:${r.statusId}`));
  let n = 0;
  for (const l of leads) {
    if (l.pipeline_id && l.status_id && keys.has(`${l.pipeline_id}:${l.status_id}`)) n++;
  }
  return n;
}

/**
 * "Passou por": lead que está atualmente na etapa OU tem, no histórico real
 * (eventsByLead), um evento de entrada nela. Resolve a etapa pelo pipeline
 * ATUAL do lead (não pelo pipeline gravado no evento) — evita colisão de
 * status_id repetido entre funis.
 */
export function countPassedThrough(
  leads: DashboardLead[],
  eventsByLead: Map<string, StageEvent[]>,
  refs: { pipelineId: string; statusId: string }[],
): number {
  if (refs.length === 0) return 0;
  let n = 0;
  for (const l of leads) {
    if (!l.pipeline_id) continue;
    const targetStatusIds = new Set(refs.filter((r) => r.pipelineId === l.pipeline_id).map((r) => r.statusId));
    if (targetStatusIds.size === 0) continue;
    if (l.status_id && targetStatusIds.has(l.status_id)) { n++; continue; }
    const evs = eventsByLead.get(String(l.kommo_id)) || [];
    if (evs.some((e) => e.after && targetStatusIds.has(e.after))) n++;
  }
  return n;
}

export interface StageRefLabel { pipelineName: string; stageName: string; }

/**
 * Resolve pares (funil, etapa) pra nomes legíveis — usado pro card de Métrica
 * Personalizada mostrar de onde ela vem (ex.: "Comercial: Agendamento"), já
 * que o numerador/denominador podem misturar etapas de funis diferentes.
 */
export function describeStageRefs(
  pipelines: Array<{ kommo_id: string; name: string; statuses: KommoStatus[] | null }>,
  refs: { pipelineId: string; statusId: string }[],
): StageRefLabel[] {
  const pipelineById = new Map(pipelines.map((p) => [p.kommo_id, p]));
  return refs.map((r) => {
    const pipeline = pipelineById.get(r.pipelineId);
    const stage = pipeline?.statuses?.find((s) => s.id === r.statusId);
    return {
      pipelineName: pipeline?.name ?? r.pipelineId,
      stageName: stage?.name ?? r.statusId,
    };
  });
}
