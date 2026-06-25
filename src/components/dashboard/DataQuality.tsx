import { CustomField } from "@/hooks/useKommoData";
import { ClipboardCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";
import { cn } from "@/lib/utils";

interface DataQualityProps { customFields: CustomField[]; overallFillRate?: number; }

const formatPercentage = (v: number) => `${v.toFixed(1)}%`;
const getProgressColor = (p: number) => (p >= 80 ? "bg-success" : p >= 50 ? "bg-warning" : "bg-destructive");
const getQualityClass = (p: number) => (p >= 80 ? "quality-good" : p >= 50 ? "quality-warning" : "quality-bad");

export function DataQuality({ customFields, overallFillRate = 0 }: DataQualityProps) {
  const sortedFields = [...customFields].sort((a, b) => a.filledPercentage - b.filledPercentage);

  if (customFields.length === 0) {
    return (
      <div className="dashboard-section animate-slide-up">
        <h2 className="section-title">
          <ClipboardCheck className="w-5 h-5 text-primary-ink" />
          Qualidade de Preenchimento
        </h2>
        <p className="text-muted-foreground text-center py-8">Nenhum campo personalizado configurado.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-section animate-slide-up">
      <div className="flex items-center justify-between mb-6">
        <h2 className="section-title mb-0">
          <ClipboardCheck className="w-5 h-5 text-primary-ink" />
          Qualidade de Preenchimento
          <SectionTooltip text="Taxa de preenchimento dos campos personalizados nas oportunidades." />
        </h2>
        <div className={cn("px-4 py-2 rounded-2xl text-sm font-bold border", getQualityClass(overallFillRate))}>
          Completo: {formatPercentage(overallFillRate)}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-5">
        Média de preenchimento dos campos visíveis: <span className="font-bold">{formatPercentage(overallFillRate)}</span>
      </p>

      <div className="space-y-3">
        {sortedFields.map((f) => {
          const Icon = f.filledPercentage >= 50 ? CheckCircle2 : AlertCircle;
          const iconColor = f.filledPercentage >= 50 ? "text-success" : "text-destructive";
          const bgColor = f.filledPercentage >= 50 ? "bg-success/5 border-success/10" : "bg-destructive/5 border-destructive/10";
          const textColor = f.filledPercentage >= 50 ? "text-success" : "text-destructive";

          return (
            <div key={f.name} className={cn("p-3 border rounded-2xl", bgColor)}>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Icon className={cn("w-4 h-4 shrink-0", iconColor)} />
                  <span className="text-sm font-semibold truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    · {f.filledCount}/{f.totalLeads}
                  </span>
                </div>
                <span className={cn("text-sm font-bold tabular-nums shrink-0", textColor)}>{formatPercentage(f.filledPercentage)}</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-500", getProgressColor(f.filledPercentage))} style={{ width: `${f.filledPercentage}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
