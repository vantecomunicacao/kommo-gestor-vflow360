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

const stageRefSchema = z.object({
  pipelineId: z.string().min(1),
  statusId: z.string().min(1),
});
export type StageRef = { pipelineId: string; statusId: string };

export const customMetricSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Dê um nome pra métrica").max(60),
  format: z.enum(["percent", "number"]),
  icon: z.enum(CUSTOM_METRIC_ICON_KEYS as [CustomMetricIconKey, ...CustomMetricIconKey[]]).catch(DEFAULT_CUSTOM_METRIC_ICON),
  numerator: z.array(stageRefSchema).min(1, "Escolha ao menos 1 etapa").max(MAX_STAGE_REFS_PER_SIDE),
  denominator: z.array(stageRefSchema).max(MAX_STAGE_REFS_PER_SIDE),
  // Também aparece no Relatório (coorte mensal: "alcançou/alcançou"), não só no
  // Dashboard ao vivo ("está atualmente em"). Default true — quem configura
  // provavelmente quer ver nos dois lugares; desliga por métrica se não quiser.
  reportVisible: z.boolean().default(true),
});
export type CustomMetric = z.infer<typeof customMetricSchema>;

export const customMetricsListSchema = z.array(customMetricSchema).max(MAX_CUSTOM_METRICS);

export const stageRefKey = (r: StageRef) => `${r.pipelineId}:${r.statusId}`;

export const formatCustomMetricValue = (value: number | null, format: "percent" | "number"): string => {
  if (value === null) return "—";
  if (format === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString("pt-BR");
};
