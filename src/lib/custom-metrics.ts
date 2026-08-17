import { z } from "zod";
import {
  LucideIcon, Sparkles, Star, Repeat, Gauge, Clock, TrendingUp, Percent, Users,
  Target, Award, Heart, Zap, Phone, Calendar, ThumbsUp, MessageCircle,
} from "lucide-react";

// Espelha supabase/functions/_shared/schemas.ts (CustomMetricSchema). Duplicado
// porque a edge function importa zod via URL (Deno) e o front via npm (Vite) —
// runtimes diferentes, mesmo shape. Mantenha os dois em sincronia.
export const MAX_CUSTOM_METRICS = 3;
export const MAX_STAGE_REFS_PER_SIDE = 3;

// Ícones disponíveis pra métrica — lista curta e fixa (não é um picker livre de todo
// o lucide-react) pra manter consistência visual com os cards padrão do dashboard.
export const CUSTOM_METRIC_ICONS = {
  sparkles: { label: "Estrelas", Icon: Sparkles },
  star: { label: "Favorito", Icon: Star },
  repeat: { label: "Recompra", Icon: Repeat },
  gauge: { label: "Medidor", Icon: Gauge },
  clock: { label: "Tempo", Icon: Clock },
  "trending-up": { label: "Crescimento", Icon: TrendingUp },
  percent: { label: "Percentual", Icon: Percent },
  users: { label: "Pessoas", Icon: Users },
  target: { label: "Meta", Icon: Target },
  award: { label: "Prêmio", Icon: Award },
  heart: { label: "Satisfação", Icon: Heart },
  zap: { label: "Velocidade", Icon: Zap },
  phone: { label: "Telefone", Icon: Phone },
  calendar: { label: "Agenda", Icon: Calendar },
  "thumbs-up": { label: "Aprovação", Icon: ThumbsUp },
  "message-circle": { label: "Conversa", Icon: MessageCircle },
} as const satisfies Record<string, { label: string; Icon: LucideIcon }>;
export type CustomMetricIconKey = keyof typeof CUSTOM_METRIC_ICONS;
export const CUSTOM_METRIC_ICON_KEYS = Object.keys(CUSTOM_METRIC_ICONS) as CustomMetricIconKey[];
export const DEFAULT_CUSTOM_METRIC_ICON: CustomMetricIconKey = "sparkles";
export const getCustomMetricIcon = (key: string | undefined | null): LucideIcon =>
  (key && key in CUSTOM_METRIC_ICONS ? CUSTOM_METRIC_ICONS[key as CustomMetricIconKey] : CUSTOM_METRIC_ICONS[DEFAULT_CUSTOM_METRIC_ICON]).Icon;

// Cor manual por métrica — quem configura decide se o número é bom, neutro ou
// ruim (ex.: "Taxa de No Show" alta é ruim, então faz sentido em vermelho),
// não é calculado a partir de threshold/meta. Mesmas chaves do variant do
// MetricCard (src/components/dashboard/MetricCard.tsx).
export const CUSTOM_METRIC_COLORS = {
  accent: { label: "Neutro" },
  success: { label: "Bom (verde)" },
  warning: { label: "Atenção (amarelo)" },
  destructive: { label: "Ruim (vermelho)" },
} as const satisfies Record<string, { label: string }>;
export type CustomMetricColorKey = keyof typeof CUSTOM_METRIC_COLORS;
export const CUSTOM_METRIC_COLOR_KEYS = Object.keys(CUSTOM_METRIC_COLORS) as CustomMetricColorKey[];
export const DEFAULT_CUSTOM_METRIC_COLOR: CustomMetricColorKey = "accent";

const stageRefSchema = z.object({
  pipelineId: z.string().min(1),
  statusId: z.string().min(1),
});
export type StageRef = { pipelineId: string; statusId: string };

// Lado de CAMPO PERSONALIZADO: alternativa ao StageRef pra contas que marcam
// um campo em vez de mover de etapa (ex.: checkbox "Não compareceu"). `value`
// ausente/vazio = "campo preenchido" (qualquer valor conta); presente = tem
// que bater exatamente com um dos valores do campo (funciona pra select E
// multiselect — ver matchesFieldRef em _shared/custom-metrics-count.ts).
const fieldRefSchema = z.object({
  fieldId: z.string().min(1),
  value: z.string().optional(),
});
export type FieldRef = { fieldId: string; value?: string };

// Numerador/denominador aceitam os dois tipos misturados, "OU" entre tudo —
// mesma semântica que já existia entre múltiplas etapas. z.union (não
// discriminado) funciona porque os shapes são estruturalmente distintos
// (pipelineId+statusId vs fieldId) — dado salvo antes desse campo existir
// (só StageRef) continua validando igual.
const metricRefSchema = z.union([stageRefSchema, fieldRefSchema]);
export type MetricRef = StageRef | FieldRef;
export const isFieldRef = (r: MetricRef): r is FieldRef => "fieldId" in r;
export const isStageRef = (r: MetricRef): r is StageRef => "statusId" in r;

export const customMetricSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Dê um nome pra métrica").max(60),
  format: z.enum(["percent", "number"]),
  icon: z.enum(CUSTOM_METRIC_ICON_KEYS as [CustomMetricIconKey, ...CustomMetricIconKey[]]).catch(DEFAULT_CUSTOM_METRIC_ICON),
  color: z.enum(CUSTOM_METRIC_COLOR_KEYS as [CustomMetricColorKey, ...CustomMetricColorKey[]]).catch(DEFAULT_CUSTOM_METRIC_COLOR).default(DEFAULT_CUSTOM_METRIC_COLOR),
  numerator: z.array(metricRefSchema).min(1, "Escolha ao menos 1 etapa ou campo").max(MAX_STAGE_REFS_PER_SIDE),
  denominator: z.array(metricRefSchema).max(MAX_STAGE_REFS_PER_SIDE),
  // Também aparece no Relatório (coorte mensal: "alcançou/alcançou"), não só no
  // Dashboard ao vivo ("está atualmente em"). Default true — quem configura
  // provavelmente quer ver nos dois lugares; desliga por métrica se não quiser.
  reportVisible: z.boolean().default(true),
  // "cascata" (padrão): conta por posição atual + ordem das etapas, mesma
  // técnica do funil visual — robusto, mas não detecta reentrada (ex.: lead
  // que sai de "Não Compareceu" e volta pra "Agendado"). "historico": conta
  // via histórico de eventos do Kommo, detecta reentrada mas só enxerga
  // ~18-20 dias pra trás — limite de retenção da API do Kommo, não é algo que
  // dá pra sincronizar de volta. Métricas salvas antes desse campo existir
  // caem no default "cascata" (corrige subcontagem sem precisar remigrar).
  countMode: z.enum(["cascata", "historico"]).catch("cascata").default("cascata"),
});
export type CustomMetric = z.infer<typeof customMetricSchema>;

export const COUNT_MODE_OPTIONS: Record<"cascata" | "historico", { label: string; description: string }> = {
  cascata: {
    label: "Cascata (recomendado)",
    description: "Conta quem está nessa etapa ou já avançou além dela. Robusto, mas não detecta reentrada.",
  },
  historico: {
    label: "Histórico de eventos",
    description: "Detecta reentrada na etapa (ex.: \"Não Compareceu\" → \"Agendado\" → \"Não Compareceu\" de novo), mas só enxerga um histórico curto — o Kommo não guarda eventos antigos.",
  },
};

export const customMetricsListSchema = z.array(customMetricSchema).max(MAX_CUSTOM_METRICS);

export const stageRefKey = (r: StageRef) => `${r.pipelineId}:${r.statusId}`;
export const fieldRefKey = (r: FieldRef) => `field:${r.fieldId}:${r.value ?? ""}`;
export const metricRefKey = (r: MetricRef) => (isFieldRef(r) ? fieldRefKey(r) : stageRefKey(r));

export const formatCustomMetricValue = (value: number | null, format: "percent" | "number"): string => {
  if (value === null) return "—";
  if (format === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString("pt-BR");
};

// Nome de funil/etapa por trás de um lado (numerador ou denominador) da
// métrica — vem resolvido do backend (kommo-dashboard/pure.ts describeStageRefs).
export type StageRefLabel = { pipelineName: string; stageName: string };
// Idem, pro lado de campo personalizado (kommo-dashboard/pure.ts describeFieldRefs).
export type FieldRefLabel = { fieldName: string; valueLabel: string | null };

// Subtítulo curto do card: nomes de funil únicos envolvidos na métrica (dos
// dois lados) + nomes de campo personalizado, se a métrica usar algum. Uma
// métrica de funil só mostra 1 nome; uma que mistura funis (schema permite)
// mostra os dois, deixando isso visível de relance.
export const customMetricPipelineSummary = (
  numeratorRefs: StageRefLabel[] | undefined, denominatorRefs: StageRefLabel[] | undefined,
  numeratorFieldRefs?: FieldRefLabel[], denominatorFieldRefs?: FieldRefLabel[],
): string => {
  const names = Array.from(new Set([...(numeratorRefs ?? []), ...(denominatorRefs ?? [])].map((r) => r.pipelineName)));
  const fieldNames = Array.from(new Set([...(numeratorFieldRefs ?? []), ...(denominatorFieldRefs ?? [])].map((r) => `Campo: ${r.fieldName}`)));
  return [...names, ...fieldNames].join(" + ");
};

// Tooltip detalhado: mostra exatamente quais etapas compõem cada lado E o
// número exato de leads por trás (não a prévia aproximada da tela de
// Configurações, que conta pelo status atual e pode divergir do valor real
// no Dashboard/Relatório) — esclarece o cálculo e ajuda a flagrar
// configuração errada (ex.: etapa do funil errado escolhida por engano).
export const customMetricTooltip = (m: {
  format: "percent" | "number";
  numeratorRefs?: StageRefLabel[]; denominatorRefs?: StageRefLabel[];
  numeratorFieldRefs?: FieldRefLabel[]; denominatorFieldRefs?: FieldRefLabel[];
  numeratorCount?: number; denominatorCount?: number | null;
  countMode?: "cascata" | "historico";
  eventsHistorySince?: string | null;
}): string => {
  const side = (
    refs: StageRefLabel[] | undefined, fieldRefs: FieldRefLabel[] | undefined, count: number | null | undefined,
  ) => {
    const stageLabels = (refs ?? []).map((r) => `${r.stageName} (${r.pipelineName})`);
    const fieldLabels = (fieldRefs ?? []).map((r) => `${r.fieldName}${r.valueLabel ? ` = ${r.valueLabel}` : " (preenchido)"}`);
    const label = [...stageLabels, ...fieldLabels].join(" + ") || "—";
    return count == null ? label : `${label} (${count})`;
  };
  const base = m.format === "number"
    ? `Contagem: ${side(m.numeratorRefs, m.numeratorFieldRefs, m.numeratorCount)}`
    : `${side(m.numeratorRefs, m.numeratorFieldRefs, m.numeratorCount)} ÷ ${side(m.denominatorRefs, m.denominatorFieldRefs, m.denominatorCount)}`;
  if (m.countMode !== "historico") return base;
  const since = m.eventsHistorySince ? new Date(m.eventsHistorySince).toLocaleDateString("pt-BR") : null;
  return `${base} — modo histórico: só enxerga reentradas${since ? ` a partir de ${since}` : ""}.`;
};
