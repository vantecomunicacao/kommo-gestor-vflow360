// Extraído de src/pages/Reports.tsx (Fase 5 do plano de remediação, 2026-08) —
// catálogo de métricas e helpers puros, sem nenhuma dependência de estado do
// componente. Extração mecânica, mesmo código, sem mudança de comportamento.

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatBRL } from "@/lib/format";
import type { DateBasis, ReportMetrics, ReportMonth } from "@/hooks/useReportSnapshots";

export type Fmt = "num" | "brl" | "pct";

export interface MetricDef {
  id: string;
  label: string;
  fmt: Fmt;
  value: (m: ReportMetrics) => number;
  invert?: boolean;        // cair é bom (perda, receita perdida)
  showDirection?: boolean; // mostra seta ▲▼ colorida mesmo no modo Valores (taxas)
  desc?: string;           // explicação curta (tooltip na pill e na linha)
  tag?: string;            // tagzinha ao lado do nome (ex.: "coorte", "win rate")
}

// Catálogo por eixo — mesma foto, leitura diferente.
export const CATALOG: Record<DateBasis, MetricDef[]> = {
  criacao: [
    { id: "leads", label: "Leads Criados", fmt: "num", value: (m) => m.leads, desc: "Leads criados no mês (safra por data de criação)." },
    { id: "won", label: "Vendas", fmt: "num", value: (m) => m.won, desc: "Da safra criada no mês, quantos viraram venda ganha." },
    { id: "wonRevenue", label: "Receita Ganha", fmt: "brl", value: (m) => m.wonRevenue, desc: "Soma do valor das vendas ganhas da safra." },
    { id: "ticket", label: "Ticket Médio", fmt: "brl", value: (m) => m.ticket, desc: "Receita ganha ÷ nº de vendas ganhas." },
    // Conversão por coorte: da entrada (leads criados no mês) até a venda ganha,
    // tenha o lead fechado quando tiver fechado. Meses recentes ainda amadurecem.
    { id: "convGeral", label: "Taxa de Conversão", tag: "coorte", fmt: "pct", showDirection: true,
      value: (m) => m.leads > 0 ? (m.won / m.leads) * 100 : 0,
      desc: "Vendas ganhas ÷ leads que ENTRARAM no mês (por safra de criação), independente de quando fecharam. Meses recentes ainda estão maturando: a taxa tende a subir conforme os leads em aberto fecham." },
  ],
  fechamento: [
    { id: "won", label: "Vendas Ganhas", fmt: "num", value: (m) => m.won, desc: "Negócios ganhos no mês (por data de fechamento)." },
    { id: "lost", label: "Vendas Perdidas", fmt: "num", value: (m) => m.lost, invert: true, desc: "Negócios perdidos no mês (por data de fechamento)." },
    { id: "wonRevenue", label: "Receita Ganha", fmt: "brl", value: (m) => m.wonRevenue, desc: "Soma do valor dos negócios ganhos." },
    { id: "lostRevenue", label: "Receita Perdida", fmt: "brl", value: (m) => m.lostRevenue, invert: true, desc: "Soma do valor dos negócios perdidos. Cair é bom." },
    { id: "ticket", label: "Ticket Médio", fmt: "brl", value: (m) => m.ticket, desc: "Receita ganha ÷ nº de vendas ganhas." },
    // Win rate: KPI de saúde comercial. Fica disponível como pill, mas desligado por padrão.
    { id: "taxaFechamento", label: "Taxa de Fechamento", tag: "win rate", fmt: "pct", value: (m) => m.winRate, showDirection: true,
      desc: "Vendas ganhas ÷ (ganhas + perdidas). Win rate entre os negócios que JÁ decidiram no mês — mede qualidade da negociação, não conversão do funil. Complementar à Taxa de Conversão (por coorte), não substitui." },
  ],
};

export const DEFAULT_VISIBLE: Record<DateBasis, string[]> = {
  criacao: ["leads", "won", "wonRevenue", "ticket", "convGeral"],
  fechamento: ["won", "lost", "wonRevenue", "lostRevenue", "ticket"],
};

export const fmtValue = (v: number, fmt: Fmt) =>
  fmt === "brl" ? formatBRL(v) : fmt === "pct" ? `${v.toFixed(1)}%` : new Intl.NumberFormat("pt-BR").format(v);

export const monthLabel = (iso: string) => format(new Date(iso + "T12:00:00"), "MMM/yy", { locale: ptBR });

// Cor conforme direção, respeitando o sentido (invert = cair é bom).
export function trendClass(curr: number, prev: number, invert?: boolean): string {
  if (prev === curr) return "text-muted-foreground";
  const up = curr > prev;
  const good = invert ? !up : up;
  return good ? "text-success" : "text-destructive";
}

export function pctChange(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? "novo" : "—";
  const ch = ((curr - prev) / Math.abs(prev)) * 100;
  if (Math.abs(ch) < 0.1) return "0%";
  return `${ch > 0 ? "+" : ""}${ch.toFixed(0)}%`;
}

/**
 * Aplica os vendedores selecionados: soma os sub-blocos bySeller escolhidos, mês a
 * mês, recalculando ticket (receita/vendas) e winRate (vendas/fechados) — proporções
 * não podem ser somadas. Vazio = todos (usa a foto agregada como está).
 */
export function aggregateBySellers(rawMonths: ReportMonth[], sellerIds: string[]): ReportMonth[] {
  if (sellerIds.length === 0) return rawMonths;
  return rawMonths.map((mo) => {
    const acc = { leads: 0, won: 0, wonRevenue: 0, lost: 0, lostRevenue: 0 };
    for (const id of sellerIds) {
      const s = mo.metrics.bySeller?.[id];
      if (!s) continue;
      acc.leads += s.leads; acc.won += s.won; acc.wonRevenue += s.wonRevenue;
      acc.lost += s.lost; acc.lostRevenue += s.lostRevenue;
    }
    const closed = acc.won + acc.lost;
    return {
      ...mo,
      metrics: {
        ...acc,
        ticket: acc.won > 0 ? acc.wonRevenue / acc.won : 0,
        winRate: closed > 0 ? (acc.won / closed) * 100 : 0,
      },
    };
  });
}

/** Catálogo = métricas do eixo + (na aba Comercial) taxas de etapa derivadas das fotos. */
export function buildReachCatalog(dateBasis: DateBasis, months: ReportMonth[]): MetricDef[] {
  const base = CATALOG[dateBasis];
  if (dateBasis !== "criacao") return base;
  const latest = [...months].reverse().find((mo) => (mo.metrics.reached?.length ?? 0) > 0);
  const reachDefs: MetricDef[] = (latest?.metrics.reached ?? []).flatMap((r) => {
    // Contagem bruta: quantos leads da safra chegaram na etapa selecionada.
    const countDef: MetricDef = {
      id: `count:${r.id}`,
      label: r.label,
      fmt: "num",
      value: (m: ReportMetrics) => m.reached?.find((x) => x.id === r.id)?.count ?? 0,
      desc: `Nº de leads da safra que chegaram na etapa "${r.label}".`,
    };
    // Bucket "fechamento": mantém só a contagem (sem taxa própria). Demais buckets
    // também ganham a taxa "% da safra que chegou na etapa".
    if (r.id === "fechamento") return [countDef];
    const rateDef: MetricDef = {
      id: `reach:${r.id}`,
      label: `Taxa ${r.label}`,
      fmt: "pct",
      showDirection: true,
      value: (m: ReportMetrics) => {
        const item = m.reached?.find((x) => x.id === r.id);
        return m.leads > 0 && item ? (item.count / m.leads) * 100 : 0;
      },
      desc: `% da safra que chegou na etapa "${r.label}" (alcançou ÷ entrada).`,
    };
    return [countDef, rateDef];
  });
  return [...base, ...reachDefs];
}
