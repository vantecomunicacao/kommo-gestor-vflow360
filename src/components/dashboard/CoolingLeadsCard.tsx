import { useState } from "react";
import { Snowflake, Clock, Flame, AlertTriangle, CheckCircle2, User } from "lucide-react";
import { CoolingLeads, CoolingLead } from "@/hooks/useKommoData";
import { SectionTooltip } from "./SectionTooltip";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface CoolingLeadsCardProps {
  data?: CoolingLeads | null;
}

type BucketKey = "warning" | "alert" | "critical";

export function CoolingLeadsCard({ data }: CoolingLeadsCardProps) {
  const [openBucket, setOpenBucket] = useState<BucketKey | null>(null);
  const t = data?.thresholds ?? { warning: 7, alert: 10, critical: 14 };

  const tiles: {
    key: BucketKey;
    icon: typeof Clock;
    count: number;
    label: string;
    sub: string;
    cls: string;
    iconCls: string;
  }[] = [
    {
      key: "warning",
      icon: Clock,
      count: data?.warning ?? 0,
      label: `${t.warning}–${t.alert - 1} dias parado`,
      sub: "Atenção",
      cls: "bg-warning/10 text-warning-ink border-warning/30",
      iconCls: "bg-warning/15 text-warning-ink",
    },
    {
      key: "alert",
      icon: AlertTriangle,
      count: data?.alert ?? 0,
      label: `${t.alert}–${t.critical - 1} dias parado`,
      sub: "Alerta",
      cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
      iconCls: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    },
    {
      key: "critical",
      icon: Flame,
      count: data?.critical ?? 0,
      label: `${t.critical}+ dias parado`,
      sub: "Crítico",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
      iconCls: "bg-destructive/15 text-destructive",
    },
  ];

  const activeTile = tiles.find((x) => x.key === openBucket);
  const list: CoolingLead[] = openBucket && data?.leads ? data.leads[openBucket] : [];

  return (
    <div className="dashboard-section animate-slide-up">
      <div className="flex items-center justify-between mb-5 gap-3">
        <h2 className="section-title mb-0">
          <Snowflake className="w-5 h-5 text-primary-ink" />
          Leads esfriando
          <SectionTooltip text={`Oportunidades abertas sem atividade (mudança de etapa ou mensagem) há ${t.warning} dias ou mais. Considera todas as oportunidades em aberto, respeitando os filtros de funil, etapa e vendedor — ignora o período selecionado. Clique em uma faixa para ver os leads.`} />
        </h2>
        {data && data.total > 0 && (
          <span className="text-xs font-semibold text-muted-foreground shrink-0">
            {data.total} no total
          </span>
        )}
      </div>

      {data && data.total === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-8 gap-2">
          <CheckCircle2 className="w-8 h-8 text-success" />
          <p className="text-sm font-medium text-foreground">Nenhum lead esfriando 🎉</p>
          <p className="text-xs text-muted-foreground">Todas as oportunidades abertas tiveram atividade recente.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {tiles.map((tile) => {
            const clickable = tile.count > 0 && !!data?.leads;
            return (
              <button
                key={tile.key}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setOpenBucket(tile.key)}
                className={cn(
                  "rounded-xl border p-4 flex items-center gap-3 text-left transition-shadow",
                  tile.cls,
                  clickable ? "cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current" : "cursor-default opacity-90",
                )}
              >
                <div className={cn("p-2 rounded-lg shrink-0", tile.iconCls)}>
                  <tile.icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold leading-none">{tile.count}</p>
                  <p className="text-xs font-semibold mt-1">{tile.sub}</p>
                  <p className="text-[11px] opacity-80 truncate">{tile.label}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!openBucket} onOpenChange={(o) => !o && setOpenBucket(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeTile && <activeTile.icon className="w-4 h-4" />}
              Leads — {activeTile?.sub} ({activeTile?.label})
            </DialogTitle>
            <DialogDescription>
              {list.length === 0
                ? "Sem leads nesta faixa."
                : `${list.length}${list.length === 100 ? "+" : ""} oportunidade(s), ordenadas pelas mais paradas.`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 divide-y divide-border">
            {list.map((lead, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{lead.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <User className="w-3 h-3 shrink-0" />
                    {lead.seller || "Não atribuído"}
                  </p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground shrink-0 whitespace-nowrap">
                  {lead.days} dias
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
