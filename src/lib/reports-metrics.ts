// Extraído de src/pages/Reports.tsx (Fase 5 do plano de remediação, 2026-08) —
// catálogo de métricas e helpers puros, sem nenhuma dependência de estado do
// componente. Extração mecânica, mesmo código, sem mudança de comportamento.

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatBRL } from "@/lib/format";
import type { DateBasis, ReportMetrics, ReportMonth } from "@/hooks/useReportSnapshots";

export type Fmt = "num" | "brl" | "pct";

// Janela de meses que o kommo-report-snapshot calcula/grava (cron + recompute
// manual). 24, não 12: "Comparar com: mesmo mês, ano passado" precisa do mês
// 12 meses antes de cada um dos 12 meses exibidos por padrão — com janela de
// só 12, o YoY quase nunca teria base. Ver supabase/migrations/*_kommo_report_snapshot_months_24.sql.
export const REPORT_SNAPSHOT_MONTHS = 24;

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
    { id: "lost", label: "Perdas", fmt: "num", invert: true, value: (m) => m.lost, desc: "Da safra criada no mês, quantos viraram venda perdida. Cair é bom." },
    { id: "leadsOpen", label: "Em Aberto", fmt: "num", value: (m) => Math.max(0, m.leads - m.won - m.lost),
      desc: "Da safra criada no mês, quantos ainda não ganharam nem perderam. Alto em meses recentes não é ruim — é sinal de que a safra ainda está maturando (ver aviso de coorte abaixo)." },
    { id: "wonRevenue", label: "Receita Ganha", fmt: "brl", value: (m) => m.wonRevenue, desc: "Soma do valor das vendas ganhas da safra." },
    { id: "lostRevenue", label: "Receita Perdida", fmt: "brl", invert: true, value: (m) => m.lostRevenue, desc: "Soma do valor das vendas perdidas da safra. Cair é bom." },
    { id: "ticket", label: "Ticket Médio", fmt: "brl", value: (m) => m.ticket, desc: "Receita ganha ÷ nº de vendas ganhas." },
    // Conversão por coorte: da entrada (leads criados no mês) até a venda ganha,
    // tenha o lead fechado quando tiver fechado. Meses recentes ainda amadurecem.
    { id: "convGeral", label: "Taxa de Conversão", fmt: "pct", showDirection: true,
      value: (m) => m.leads > 0 ? (m.won / m.leads) * 100 : 0,
      desc: "Vendas ganhas ÷ leads que ENTRARAM no mês (por safra de criação), independente de quando fecharam. Meses recentes ainda estão maturando: a taxa tende a subir conforme os leads em aberto fecham." },
    { id: "cycleDays", label: "Ciclo Médio", fmt: "num", value: (m) => m.cycleDays ?? 0,
      desc: "Dias médios entre a criação do lead e o fechamento, só das vendas GANHAS da safra (em dias). Sem amostra suficiente = 0." },
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
  criacao: ["leads", "won", "lost", "leadsOpen", "wonRevenue", "ticket", "convGeral"],
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

export type CompareMode = "previous" | "yoy" | "movavg3" | "none";

// Desloca um mês ISO ("YYYY-MM-DD", 1º dia do mês) por `n` meses (negativo =
// pra trás). Aritmética pura sobre ano/mês — sem Date/timezone envolvidos.
export function shiftMonthKey(monthISO: string, n: number): string {
  const [y, m] = monthISO.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/**
 * Resolve o valor de referência pra comparar `targetMonth`, buscando por
 * MÊS-CALENDÁRIO na série completa (não por posição/índice de um array
 * recortado) — assim a 1ª coluna visível também pode ter comparação, se o mês
 * anterior já estiver carregado. Retorna `null` quando não há base suficiente
 * — nunca finge um valor parcial (ex.: média móvel com só 1 de 3 meses).
 */
export function resolveComparisonValue(
  months: ReportMonth[],
  targetMonth: string,
  mode: CompareMode,
  value: (m: ReportMetrics) => number,
): number | null {
  if (mode === "none") return null;
  const byMonth = new Map(months.map((m) => [m.month, m]));
  if (mode === "previous") {
    const ref = byMonth.get(shiftMonthKey(targetMonth, -1));
    return ref ? value(ref.metrics) : null;
  }
  if (mode === "yoy") {
    const ref = byMonth.get(shiftMonthKey(targetMonth, -12));
    return ref ? value(ref.metrics) : null;
  }
  // movavg3: exige os 3 meses anteriores presentes — senão seria uma média
  // parcial ambígua (ex.: média de 1 mês só, disfarçada de "móvel de 3").
  const refs = [1, 2, 3].map((n) => byMonth.get(shiftMonthKey(targetMonth, -n)));
  if (refs.some((r) => !r)) return null;
  const sum = refs.reduce((acc, r) => acc + value(r!.metrics), 0);
  return sum / 3;
}

/**
 * Aplica os vendedores selecionados: soma os sub-blocos bySeller escolhidos, mês a
 * mês, recalculando ticket (receita/vendas) e winRate (vendas/fechados) — proporções
 * não podem ser somadas. Vazio = todos (usa a foto agregada como está).
 *
 * `reached` (taxas de etapa) usa a célula agregada (`mo.metrics.reached`) como
 * template de ORDEM e RÓTULO — não reconstrói a lista a partir dos sub-blocos de
 * vendedor, pois a ordem vem de `report_rate_stages` (configurável) e precisa ficar
 * igual à visão "todos os vendedores" ao alternar o filtro. Só o `count` é recalculado.
 */
export function aggregateBySellers(rawMonths: ReportMonth[], sellerIds: string[]): ReportMonth[] {
  if (sellerIds.length === 0) return rawMonths;
  return rawMonths.map((mo) => {
    const acc = { leads: 0, won: 0, wonRevenue: 0, lost: 0, lostRevenue: 0 };
    const reachedCount = new Map<string, number>();
    const customPassed = new Map<string, number>();
    const customBase = new Map<string, number>();
    // cycleDays é uma MÉDIA por vendedor, não soma — pra recombinar sem viés,
    // pondera pelo tamanho da amostra de cada um (não dá pra simplesmente somar
    // ou tirar média simples das médias, senão vendedor com 1 venda pesa igual
    // a vendedor com 50).
    let cycleDaysWeightedSum = 0, cycleDaysSampleTotal = 0;
    for (const id of sellerIds) {
      const s = mo.metrics.bySeller?.[id];
      if (!s) continue;
      acc.leads += s.leads; acc.won += s.won; acc.wonRevenue += s.wonRevenue;
      acc.lost += s.lost; acc.lostRevenue += s.lostRevenue;
      if (s.cycleDaysSampleSize) {
        cycleDaysWeightedSum += (s.cycleDays ?? 0) * s.cycleDaysSampleSize;
        cycleDaysSampleTotal += s.cycleDaysSampleSize;
      }
      for (const r of s.reached ?? []) reachedCount.set(r.id, (reachedCount.get(r.id) ?? 0) + r.count);
      for (const r of s.customRates ?? []) {
        customPassed.set(r.id, (customPassed.get(r.id) ?? 0) + r.passed);
        customBase.set(r.id, (customBase.get(r.id) ?? 0) + r.base);
      }
    }
    const closed = acc.won + acc.lost;
    const reached = mo.metrics.reached?.map((r) => ({ ...r, count: reachedCount.get(r.id) ?? 0 }));
    const customRates = mo.metrics.customRates?.map((r) => ({
      ...r, passed: customPassed.get(r.id) ?? 0, base: customBase.get(r.id) ?? 0,
    }));
    return {
      ...mo,
      metrics: {
        ...acc,
        ticket: acc.won > 0 ? acc.wonRevenue / acc.won : 0,
        winRate: closed > 0 ? (acc.won / closed) * 100 : 0,
        cycleDays: cycleDaysSampleTotal > 0 ? Math.round((cycleDaysWeightedSum / cycleDaysSampleTotal) * 10) / 10 : 0,
        cycleDaysSampleSize: cycleDaysSampleTotal,
        reached,
        customRates,
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

/**
 * Métricas Personalizadas visíveis no Relatório (safra por criação) — substitui
 * as antigas "Taxas de fase" por pares pipeline+status livres, a mesma
 * configuração que já alimenta o Dashboard ao vivo, só que calculada como
 * coorte mensal ("alcançou/alcançou") em vez de "está atualmente em". Ver
 * kommo-report-snapshot/index.ts. Devolve só os itens novos — compor com
 * `buildReachCatalog` (que já traz o catálogo base do eixo).
 */
export function buildCustomRateCatalog(dateBasis: DateBasis, months: ReportMonth[]): MetricDef[] {
  if (dateBasis !== "criacao") return [];
  const latest = [...months].reverse().find((mo) => (mo.metrics.customRates?.length ?? 0) > 0);
  return (latest?.metrics.customRates ?? []).map((r): MetricDef => {
    if (r.format === "number") {
      return {
        id: `custom:${r.id}`,
        label: r.name,
        fmt: "num",
        tag: "personalizada",
        value: (m: ReportMetrics) => m.customRates?.find((x) => x.id === r.id)?.passed ?? 0,
        desc: `Métrica personalizada — nº de leads da safra que alcançaram "${r.name}".`,
      };
    }
    return {
      id: `custom:${r.id}`,
      label: r.name,
      fmt: "pct",
      tag: "personalizada",
      showDirection: true,
      value: (m: ReportMetrics) => {
        const item = m.customRates?.find((x) => x.id === r.id);
        return item && item.base > 0 ? (item.passed / item.base) * 100 : 0;
      },
      desc: `Métrica personalizada — % da safra que alcançou o numerador, entre quem alcançou o denominador ("${r.name}").`,
    };
  });
}
