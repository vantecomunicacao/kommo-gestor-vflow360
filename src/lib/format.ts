/** Formatação monetária BRL compartilhada (Dashboard, Relatório, cards). */
export const formatBRL = (v: number): string =>
  v >= 100_000
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(v)
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
