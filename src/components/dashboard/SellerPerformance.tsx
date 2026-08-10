import { useMemo, useState } from "react";
import { Seller } from "@/hooks/useKommoData";
import { Users, Trophy, Medal, Search } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SellerPerformanceProps {
  sellers: Seller[];
  selectedSellerIds?: string[];
  onSellerToggle?: (id: string) => void;
  onClearSellers?: () => void;
}

export function SellerPerformance({ sellers, selectedSellerIds = [], onSellerToggle, onClearSellers }: SellerPerformanceProps) {
  const [query, setQuery] = useState("");
  const sortedSellers = useMemo(
    () => [...sellers].sort((a, b) => b.vendaGanha - a.vendaGanha),
    [sellers]
  );
  const visibleSellers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedSellers;
    return sortedSellers.filter((s) => s.name.toLowerCase().includes(q));
  }, [sortedSellers, query]);
  const interactive = !!onSellerToggle;
  const handleRowClick = (id: string | undefined) => {
    if (!interactive || !id) return;
    onSellerToggle!(id);
  };

  const getRankBadge = (i: number) => {
    if (i === 0) return <Trophy className="w-4 h-4 text-warning-ink" />;
    if (i === 1) return <Medal className="w-4 h-4 text-muted-foreground" />;
    if (i === 2) return <Medal className="w-4 h-4 text-warning-ink/70" />;
    return null;
  };

  if (sellers.length === 0) {
    return (
      <div className="dashboard-section animate-slide-up">
        <h2 className="section-title">
          <Users className="w-5 h-5 text-primary-ink" />
          Performance por Vendedor
        </h2>
        <p className="text-muted-foreground text-center py-8">Nenhum vendedor com oportunidades no período.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-section animate-slide-up">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="section-title mb-0">
          <Users className="w-5 h-5 text-primary-ink" />
          Performance por Vendedor
          <SectionTooltip text={
            interactive
              ? "Comparativo entre vendedores: total de leads e oportunidades atribuídas por etapa, taxa de conversão e leads perdidos (coluna à parte, não soma no total). Clique em uma linha para filtrar o dashboard inteiro por esse vendedor."
              : "Comparativo entre vendedores: total de leads e oportunidades atribuídas por etapa, taxa de conversão e leads perdidos (coluna à parte, não soma no total)."
          } />
        </h2>
        <div className="flex items-center gap-3 ml-auto">
          {sellers.length > 5 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar vendedor..."
                className="h-8 w-48 pl-8 text-xs"
              />
            </div>
          )}
          {interactive && selectedSellerIds.length > 0 && (
            <button
              type="button"
              onClick={() => onClearSellers?.()}
              className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Limpar filtro de vendedor
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Vendedor</th>
              <th className="text-center">Total de Leads</th>
              <th className="text-center">Contato Inicial</th>
              <th className="text-center">Proposta Enviada</th>
              <th className="text-center">Fechamento</th>
              <th className="text-center">Venda Ganha</th>
              <th className="text-center">Taxa Conversão</th>
              <th className="text-center">Perdidos</th>
            </tr>
          </thead>
          <tbody>
            {visibleSellers.map((s) => {
              const realIndex = sortedSellers.indexOf(s);
              const rate = s.contatoInicial > 0 ? ((s.vendaGanha / s.contatoInicial) * 100).toFixed(1) : "0.0";
              const totalLeads = s.contatoInicial + s.propostaEnviada + s.fechamento + s.vendaGanha;
              const isSelected = !!s.id && selectedSellerIds.includes(s.id);
              const canClick = interactive && !!s.id;
              return (
                <tr
                  key={(s.id || s.name) + realIndex}
                  onClick={canClick ? () => handleRowClick(s.id) : undefined}
                  onKeyDown={canClick ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick(s.id);
                    }
                  } : undefined}
                  tabIndex={canClick ? 0 : undefined}
                  role={canClick ? "button" : undefined}
                  aria-pressed={canClick ? isSelected : undefined}
                  aria-label={canClick ? `${isSelected ? "Remover filtro de" : "Filtrar dashboard por"} ${s.name}` : undefined}
                  className={cn(
                    canClick && "cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                    isSelected && "bg-primary/5 hover:bg-primary/10",
                  )}
                  title={canClick ? (isSelected ? "Clique para limpar o filtro" : "Filtrar dashboard por este vendedor") : undefined}
                >
                  <td className="font-semibold w-12">
                    <div className="flex items-center gap-2">{getRankBadge(realIndex)}{realIndex + 1}</div>
                  </td>
                  <td className="font-semibold">{s.name}</td>
                  <td className="text-center">
                    <span className="inline-flex items-center justify-center min-w-10 h-7 px-2 bg-secondary text-foreground rounded-lg font-bold text-sm">{totalLeads}</span>
                  </td>
                  <td className="text-center">
                    <span className="inline-flex items-center justify-center min-w-10 h-7 px-2 bg-funnel-1/10 text-funnel-1-ink rounded-lg font-bold text-sm">{s.contatoInicial}</span>
                  </td>
                  <td className="text-center">
                    <span className="inline-flex items-center justify-center min-w-10 h-7 px-2 bg-funnel-2/10 text-funnel-2-ink rounded-lg font-bold text-sm">{s.propostaEnviada}</span>
                  </td>
                  <td className="text-center">
                    <span className="inline-flex items-center justify-center min-w-10 h-7 px-2 bg-funnel-3/10 text-funnel-3-ink rounded-lg font-bold text-sm">{s.fechamento}</span>
                  </td>
                  <td className="text-center">
                    <span className="inline-flex items-center justify-center min-w-10 h-7 px-2 bg-funnel-4/10 text-funnel-4-ink rounded-lg font-bold text-sm">{s.vendaGanha}</span>
                  </td>
                  <td className="text-center"><span className="font-bold text-primary-ink">{rate}%</span></td>
                  <td className="text-center">
                    <span className="inline-flex items-center justify-center min-w-10 h-7 px-2 bg-destructive/10 text-destructive rounded-lg font-bold text-sm">{s.lost ?? 0}</span>
                  </td>
                </tr>
              );
            })}
            {visibleSellers.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-muted-foreground py-8 text-sm">
                  Nenhum vendedor encontrado para "{query}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
