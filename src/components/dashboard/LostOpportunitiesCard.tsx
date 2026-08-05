import { useState } from "react";
import { XCircle } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";
import { LeadListDialog } from "./LeadListDialog";
import { StageLead } from "@/hooks/useKommoData";

interface LostOpportunitiesCardProps {
  total: number;
  ratePercentage: number;
  rateLabel?: string;
  leadsDetail?: StageLead[];
}

const formatPercentage = (v: number) => `${v.toFixed(1)}%`;

export function LostOpportunitiesCard({ total, ratePercentage, rateLabel = "Taxa de perda", leadsDetail }: LostOpportunitiesCardProps) {
  const [open, setOpen] = useState(false);
  const clickable = !!leadsDetail;

  return (
    <>
      <div
        className="h-full relative bg-card border border-border rounded-2xl p-5 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-label={clickable ? `Ver ${total} oportunidades perdidas` : undefined}
        onClick={clickable ? () => setOpen(true) : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        } : undefined}
      >
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-destructive/10 blur-3xl rounded-full pointer-events-none"></div>

        <div className="relative">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
            <h3 className="font-bold text-foreground">Oportunidades Perdidas</h3>
            <SectionTooltip text="Refere-se a leads que saíram do funil antes de atingir a etapa de Venda Ganha." />
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Total acumulado</div>
              <div className="text-3xl font-black text-destructive tabular-nums leading-none">{total}</div>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex justify-between items-end mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">{rateLabel}</span>
                <span className="text-lg font-bold text-foreground tabular-nums leading-none">{formatPercentage(ratePercentage)}</span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-destructive rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(2, ratePercentage))}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {clickable && (
        <LeadListDialog
          open={open}
          onOpenChange={setOpen}
          title="Oportunidades Perdidas"
          leads={leadsDetail}
        />
      )}
    </>
  );
}
