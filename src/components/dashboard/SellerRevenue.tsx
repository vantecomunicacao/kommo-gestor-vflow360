import { useMemo } from "react";
import { HandCoins } from "lucide-react";
import { Seller } from "@/hooks/useKommoData";
import { SectionTooltip } from "./SectionTooltip";

interface SellerRevenueProps {
  sellers: Seller[];
}

const formatBRL = (v: number) => {
  if (v >= 100_000) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
};

export function SellerRevenue({ sellers }: SellerRevenueProps) {
  const ranked = useMemo(
    () =>
      (sellers || [])
        .map((s) => ({ name: s.name, revenue: s.wonRevenue ?? 0, wins: s.vendaGanha }))
        .filter((s) => s.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue),
    [sellers],
  );

  const max = ranked.length ? ranked[0].revenue : 0;
  const total = useMemo(() => ranked.reduce((s, r) => s + r.revenue, 0), [ranked]);

  return (
    <div className="dashboard-section animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title mb-0">
          <HandCoins className="w-5 h-5 text-primary-ink" />
          Receita por Vendedor
          <SectionTooltip text="Soma da receita ganha (valor dos leads marcados como Venda Ganha) por responsável, pela data de fechamento no período." />
        </h2>
        {total > 0 && (
          <span className="text-sm font-semibold text-muted-foreground">Total {formatBRL(total)}</span>
        )}
      </div>

      {ranked.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">Nenhuma venda ganha no período.</p>
      ) : (
        <div className="space-y-3">
          {ranked.map((s) => (
            <div key={s.name} className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold truncate" title={s.name}>{s.name}</span>
                <span className="text-sm font-bold text-foreground shrink-0">
                  {formatBRL(s.revenue)}
                  <span className="ml-2 text-xs font-medium text-muted-foreground">{s.wins} venda{s.wins === 1 ? "" : "s"}</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${max > 0 ? Math.max(4, (s.revenue / max) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
