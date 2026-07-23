import type { FunnelBucketKey } from "@/lib/dashboard-funnel";

/**
 * Templates de segmento (Clínicas, Imobiliária, etc.).
 *
 * Um template é apenas um "pacote de padrões" aplicado como SEMENTE sobre as
 * Configurações do Dashboard (kommo.dashboard_settings). Ao aplicar, ele preenche:
 *  - funnel_stage_labels   → rótulos das 4 fases fixas (ex.: "Consulta Agendada")
 *  - report_rate_stages    → quais fases viram taxa no Relatório (ex.: "Taxa de Agendamento")
 *  - report_goals          → metas médias do segmento, chave "<eixo>:<metricId>"
 *
 * NÃO semeia funnel_stage_mapping: esse mapeamento depende dos status_id reais do
 * Kommo de cada conta, que o template não conhece. As dicas em `mappingHints`
 * servem só como referência/documentação de qual etapa costuma cair em cada fase.
 *
 * As metas usam o mesmo formato de report_goals do Relatório (Reports.tsx):
 * chave = `${eixo}:${metricId}`, onde eixo ∈ {"criacao","fechamento"} e metricId
 * vem do CATALOG (ex.: "criacao:convGeral", "fechamento:won"). Taxas de etapa
 * usam id "reach:<fase>" (ex.: "criacao:reach:proposta_enviada").
 */
export interface SegmentTemplate {
  id: string;
  label: string;
  description: string;
  /** Rótulo custom por fase (bucket key → nome exibido). */
  stageLabels: Partial<Record<FunnelBucketKey, string>>;
  /** Fases que viram taxa no Relatório. */
  reportRateStages: FunnelBucketKey[];
  /** Metas médias do segmento; chave "<eixo>:<metricId>". */
  reportGoals: Record<string, number>;
  /** Referência de qual etapa do CRM costuma cair em cada fase (não é aplicado automaticamente). */
  mappingHints?: { hint: string; bucket: FunnelBucketKey }[];
}

/** Estado editável relevante da tela de Configurações que um template afeta. */
export interface TemplateApplyState {
  stageLabels: Record<string, string>;
  reportRateStages: string[];
  reportGoals: Record<string, number>;
}

/**
 * Mescla um template sobre o estado atual de forma NÃO destrutiva: chaves que o
 * template define vencem; todo o resto do estado do gestor é preservado.
 */
export function applyTemplateToSettings(
  template: SegmentTemplate,
  current: TemplateApplyState,
): TemplateApplyState {
  return {
    stageLabels: { ...current.stageLabels, ...template.stageLabels },
    reportRateStages: Array.from(
      new Set([...current.reportRateStages, ...template.reportRateStages]),
    ),
    reportGoals: { ...current.reportGoals, ...template.reportGoals },
  };
}

export const SEGMENT_TEMPLATES: SegmentTemplate[] = [
  {
    id: "clinicas",
    label: "Clínicas e Saúde",
    description:
      "Funil de agendamento de consultas. Destaca a Taxa de Agendamento e metas típicas de clínicas.",
    stageLabels: {
      contato_inicial: "Contato Inicial",
      proposta_enviada: "Consulta Agendada",
      fechamento: "Consulta Realizada",
      venda_ganha: "Tratamento Fechado",
    },
    reportRateStages: ["proposta_enviada"],
    reportGoals: {
      "criacao:convGeral": 25,
      "criacao:reach:proposta_enviada": 45,
      "fechamento:won": 30,
      "fechamento:taxaFechamento": 55,
    },
    mappingHints: [
      { hint: "Consulta agendada / marcada", bucket: "proposta_enviada" },
      { hint: "Consulta realizada / compareceu", bucket: "fechamento" },
      { hint: "Fechou tratamento / plano", bucket: "venda_ganha" },
    ],
  },
  {
    id: "imobiliaria",
    label: "Imobiliária",
    description:
      "Funil de visitas e propostas. Destaca a Taxa de Visita e metas típicas do setor imobiliário.",
    stageLabels: {
      contato_inicial: "Lead Qualificado",
      proposta_enviada: "Visita Agendada",
      fechamento: "Proposta Enviada",
      venda_ganha: "Contrato Fechado",
    },
    reportRateStages: ["proposta_enviada"],
    reportGoals: {
      "criacao:convGeral": 8,
      "criacao:reach:proposta_enviada": 30,
      "fechamento:won": 12,
      "fechamento:taxaFechamento": 35,
    },
    mappingHints: [
      { hint: "Visita agendada", bucket: "proposta_enviada" },
      { hint: "Proposta enviada / negociação", bucket: "fechamento" },
      { hint: "Contrato assinado", bucket: "venda_ganha" },
    ],
  },
  {
    id: "advocacia",
    label: "Advocacia",
    description:
      "Funil de consultas jurídicas e contratos. Destaca a Taxa de Reunião e metas típicas de escritórios.",
    stageLabels: {
      contato_inicial: "Primeiro Contato",
      proposta_enviada: "Reunião Agendada",
      fechamento: "Proposta de Honorários",
      venda_ganha: "Contrato Assinado",
    },
    reportRateStages: ["proposta_enviada"],
    reportGoals: {
      "criacao:convGeral": 20,
      "criacao:reach:proposta_enviada": 40,
      "fechamento:won": 25,
      "fechamento:taxaFechamento": 50,
    },
    mappingHints: [
      { hint: "Reunião / consulta agendada", bucket: "proposta_enviada" },
      { hint: "Proposta de honorários enviada", bucket: "fechamento" },
      { hint: "Contrato assinado", bucket: "venda_ganha" },
    ],
  },
  {
    id: "generico",
    label: "Genérico (padrão)",
    description:
      "Funil comercial padrão de 4 fases, sem termos de nicho. Bom ponto de partida para qualquer negócio.",
    stageLabels: {
      contato_inicial: "Contato Inicial",
      proposta_enviada: "Proposta Enviada",
      fechamento: "Fechamento",
      venda_ganha: "Venda Ganha",
    },
    reportRateStages: ["proposta_enviada"],
    reportGoals: {
      "criacao:convGeral": 20,
      "fechamento:won": 20,
      "fechamento:taxaFechamento": 40,
    },
  },
];
