// Schemas zod do body das edge functions kommo-dashboard e kommo-report-snapshot.
// Espelham EXATAMENTE a validação manual que existia antes (mesmos defaults
// tolerantes) — o objetivo é ter uma única definição por function, não apertar a
// validação. Ver docs/plano-filtros-dashboard.md § "Fase 6".
import { z } from "https://esm.sh/zod@3.23.8";

// Aceita string única OU array (compat com chamadas antigas que mandavam string) e
// sempre normaliza pra array de strings não-vazias.
const stringArray = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : []),
  z.array(z.string()),
);
const pipelineIdField = z.preprocess((v) => {
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string" && s);
  if (typeof v === "string" && v) return [v];
  return [];
}, z.array(z.string()));
const nullableString = z.preprocess((v) => (typeof v === "string" && v ? v : null), z.string().nullable());
const dateBasisField = z.preprocess((v) => (v === "fechamento" ? "fechamento" : "criacao"), z.enum(["criacao", "fechamento"]));

export const KommoDashboardPayloadSchema = z.object({
  workspace_id: z.string().min(1),
  startDate: nullableString,
  endDate: nullableString,
  dateBasis: dateBasisField,
  additionalStartDate: nullableString,
  additionalEndDate: nullableString,
  pipelineId: pipelineIdField,
  stageIds: stringArray,
  sellerIds: stringArray,
  utmMedium: stringArray,
  utmCampaign: stringArray,
  origin: stringArray,
  // Valores selecionados por filtro personalizado, chaveado pelo `id` do filtro
  // (ver CustomFilterSchema abaixo). Objeto malformado vira {} em vez de derrubar a request.
  customFilters: z.preprocess(
    (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}),
    z.record(stringArray),
  ),
});
export type KommoDashboardPayload = z.infer<typeof KommoDashboardPayloadSchema>;

// ===== Filtros Personalizados (kommo.dashboard_settings.custom_filters) =====
// Igual ao padrão de custom_metrics: validado na leitura (ignora entradas malformadas)
// e na escrita (Configurações do Dashboard). `fieldId` é o kommo_id/code do campo
// personalizado de lead cujos valores distintos viram as opções do dropdown.
export const CustomFilterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(40),
  fieldId: z.string().min(1),
});
export type CustomFilter = z.infer<typeof CustomFilterSchema>;
export const CustomFiltersListSchema = z.array(CustomFilterSchema).max(4);

// ===== Métricas Personalizadas (kommo.dashboard_settings.custom_metrics) =====
// Validado tanto na leitura (kommo-dashboard, ignora entradas malformadas em vez
// de derrubar a request) quanto na escrita (Configurações do Dashboard, no save).
const stageRef = z.object({
  pipelineId: z.string().min(1),
  statusId: z.string().min(1),
});
// Mesma lista de chaves de src/lib/custom-metrics.ts (CUSTOM_METRIC_ICON_KEYS) —
// o backend só precisa validar/repassar a string, quem desenha o ícone é o front.
const CUSTOM_METRIC_ICON_KEYS = [
  "sparkles", "star", "repeat", "gauge", "clock", "trending-up", "percent", "users",
  "target", "award", "heart", "zap", "phone", "calendar", "thumbs-up", "message-circle",
] as const;
// Mesma lista de src/lib/custom-metrics.ts (CUSTOM_METRIC_COLOR_KEYS) — cor
// manual escolhida por quem configura (ex.: "Taxa de No Show" em vermelho),
// não calculada a partir de threshold/meta.
const CUSTOM_METRIC_COLOR_KEYS = ["accent", "success", "warning", "destructive"] as const;
export const CustomMetricSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  format: z.enum(["percent", "number"]),
  icon: z.enum(CUSTOM_METRIC_ICON_KEYS).catch("sparkles"),
  color: z.enum(CUSTOM_METRIC_COLOR_KEYS).catch("accent").default("accent"),
  numerator: z.array(stageRef).min(1).max(3),
  denominator: z.array(stageRef).max(3),
  // Também aparece no Relatório (coorte mensal), não só no Dashboard ao vivo —
  // ver src/lib/custom-metrics.ts (mantido em sincronia).
  reportVisible: z.boolean().default(true),
});
export type CustomMetric = z.infer<typeof CustomMetricSchema>;
export const CustomMetricsListSchema = z.array(CustomMetricSchema).max(3);

export const KommoReportSnapshotPayloadSchema = z.object({
  workspace_id: z.string().min(1),
  // Clamp tolerante (não integer-only, igual ao comportamento manual anterior).
  months: z.preprocess(
    (v) => (Number.isFinite(v) ? Math.max(1, Math.min(36, Number(v))) : 12),
    z.number().min(1).max(36),
  ),
  // "Forçar recálculo" (menu ⋯ do Relatório): ignora a trava só para os meses no
  // intervalo [forceFrom, forceTo] (mês ISO "YYYY-MM-01"), só quando force=true.
  // O "Atualizar agora" comum e o cron NUNCA mandam esses campos — comportamento
  // de hoje (respeitar a trava sempre) fica intacto por padrão.
  force: z.boolean().optional().default(false),
  forceFrom: z.string().optional(),
  forceTo: z.string().optional(),
  // Backfill cirúrgico (disparado ao salvar Configurações quando uma Métrica
  // Personalizada é criada/alterada): recalcula SÓ o customRates dessas métricas
  // nos meses travados, sem tocar em leads/won/lost/revenue/winRate congelados.
  // Ver comentário perto de `backfillMetricIdSet` no index.ts.
  backfillMetricIds: z.array(z.string()).optional(),
});
export type KommoReportSnapshotPayload = z.infer<typeof KommoReportSnapshotPayloadSchema>;
