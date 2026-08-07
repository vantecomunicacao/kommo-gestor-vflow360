/**
 * Lógica pura das métricas do Dashboard (Comercial/Financeiro).
 *
 * Extraída de Dashboard.tsx para ser testável isoladamente — são exatamente os
 * cálculos onde um bug passa despercebido (tendências, win rate, ticket médio e o
 * sinal invertido da receita perdida). Nada aqui toca em React/Supabase.
 */

export interface Trend {
  /** Variação percentual absoluta, arredondada a 1 casa (ex.: 12.3). */
  value: number;
  /** true quando a variação é considerada positiva para o negócio. */
  isPositive: boolean;
}

/**
 * Tendência de `cur` vs `prev` (período anterior).
 *
 * Regras (idênticas ao comportamento histórico do Dashboard):
 * - `prev === 0`: sobe para 100% se `cur > 0`, senão sem tendência (undefined).
 * - variação < 0.1% (em módulo): tratada como ruído → undefined.
 * - caso geral: percentual absoluto arredondado a 1 casa; `isPositive` = subiu.
 */
export function calcTrend(cur: number, prev: number): Trend | undefined {
  if (prev === 0) return cur > 0 ? { value: 100, isPositive: true } : undefined;
  const ch = ((cur - prev) / prev) * 100;
  if (Math.abs(ch) < 0.1) return undefined;
  return { value: Math.round(Math.abs(ch) * 10) / 10, isPositive: ch > 0 };
}

/**
 * Inverte a leitura de uma tendência: usado em métricas onde CAIR é bom
 * (ex.: Receita Perdida). Mantém o valor, troca o sinal de `isPositive`.
 */
export function invertTrend(trend: Trend | undefined): Trend | undefined {
  if (!trend) return undefined;
  return { value: trend.value, isPositive: !trend.isPositive };
}

/**
 * Taxa de ganho (win rate) entre os negócios que FECHARAM no período:
 * ganhos / (ganhos + perdidos), em %. Sem fechamentos → 0.
 */
export function winRate(won: number, lost: number): number {
  const closed = won + lost;
  return closed > 0 ? (won / closed) * 100 : 0;
}

/**
 * Ticket médio: receita ganha / quantidade de vendas ganhas. Sem vendas → 0.
 */
export function ticketAverage(wonRevenue: number, wonCount: number): number {
  return wonCount > 0 ? wonRevenue / wonCount : 0;
}

/** Só os campos de DashboardData usados pelas métricas derivadas abaixo. */
export interface DashboardMetricsInput {
  totalLeads: number;
  lostLeads: number;
  funnelStages: Array<{ id: string; count: number }>;
  conversionRates: { overallConversion: number };
  wonMonetary?: number;
  negotiatingMonetary?: number;
  lostMonetary?: number;
}

/**
 * Métricas derivadas do período atual vs anterior (tendências, win rate, ticket
 * médio, receitas) — extraído de Dashboard.tsx, mesmos cálculos, sem mudança de
 * comportamento. `prevData` ausente (1º carregamento ou sem período de
 * comparação) → todas as tendências ficam `undefined`.
 */
export function deriveDashboardMetrics(data: DashboardMetricsInput, prevData: DashboardMetricsInput | null | undefined) {
  const currentWon = data.funnelStages.find((s) => s.id === "venda_ganha")?.count || 0;
  const prevWon = prevData?.funnelStages.find((s) => s.id === "venda_ganha")?.count || 0;

  const leadsTrend = prevData ? calcTrend(data.totalLeads, prevData.totalLeads) : undefined;
  const wonTrend = prevData ? calcTrend(currentWon, prevWon) : undefined;
  const convTrend = prevData ? calcTrend(data.conversionRates.overallConversion, prevData.conversionRates.overallConversion) : undefined;

  const wonRevenue = data.wonMonetary ?? 0;
  const negotiatingRevenue = data.negotiatingMonetary ?? 0;
  const ticketAvg = ticketAverage(wonRevenue, currentWon);
  const prevWonRevenue = prevData?.wonMonetary ?? 0;
  const prevNegotiatingRevenue = prevData?.negotiatingMonetary ?? 0;
  const prevTicketAvg = ticketAverage(prevWonRevenue, prevWon);
  const revenueTrend = prevData ? calcTrend(wonRevenue, prevWonRevenue) : undefined;
  const negotiatingTrend = prevData ? calcTrend(negotiatingRevenue, prevNegotiatingRevenue) : undefined;
  const ticketTrend = prevData ? calcTrend(ticketAvg, prevTicketAvg) : undefined;

  // Financeiro: taxa de ganho (win rate) entre os que fecharam, e receita perdida.
  const currentWinRate = winRate(currentWon, data.lostLeads || 0);
  const prevWinRate = winRate(prevWon, prevData?.lostLeads || 0);
  const winRateTrend = prevData ? calcTrend(currentWinRate, prevWinRate) : undefined;
  const lostRevenue = data.lostMonetary ?? 0;
  const prevLostRevenue = prevData?.lostMonetary ?? 0;
  // Perder MENOS dinheiro é positivo → invertemos o sinal da tendência.
  const lostRevenueTrend = invertTrend(prevData ? calcTrend(lostRevenue, prevLostRevenue) : undefined);

  return {
    currentWon, prevWon, leadsTrend, wonTrend, convTrend,
    wonRevenue, negotiatingRevenue, ticketAvg, revenueTrend, negotiatingTrend, ticketTrend,
    currentWinRate, winRateTrend, lostRevenue, lostRevenueTrend,
  };
}
