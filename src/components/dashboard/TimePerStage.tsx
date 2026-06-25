import { AverageTimePerStage } from "@/hooks/useKommoData";
import { Clock, Timer } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";

interface TimePerStageProps { averageTimePerStage: AverageTimePerStage; }

const formatHoursToTime = (hours: number): string => {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remaining = hours % 24;
  if (remaining === 0) return `${days} dia${days > 1 ? "s" : ""}`;
  return `${days}d ${remaining}h`;
};

export function TimePerStage({ averageTimePerStage }: TimePerStageProps) {
  const stages = [
    { name: "Contato Inicial", hours: averageTimePerStage.contatoInicial, color: "funnel-1" },
    { name: "Proposta Enviada", hours: averageTimePerStage.propostaEnviada, color: "funnel-2" },
    { name: "Fechamento", hours: averageTimePerStage.fechamento, color: "funnel-3" },
  ];
  const maxHours = Math.max(...stages.map((s) => s.hours), 1);

  return (
    <div className="dashboard-section animate-slide-up">
      <h2 className="section-title">
        <Clock className="w-5 h-5 text-primary-ink" />
        Tempo Médio por Etapa
        <SectionTooltip text="Tempo médio (em horas) que oportunidades estão na etapa atual. Identifica gargalos no funil." />
      </h2>

      <div className="space-y-5">
        {stages.map((stage) => {
          const widthPercentage = (stage.hours / maxHours) * 100;
          return (
            <div key={stage.name} className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{stage.name}</span>
                <div className="flex items-center gap-2">
                  <Timer className="w-4 h-4 text-muted-foreground" />
                  <span className="text-lg font-extrabold text-foreground">{formatHoursToTime(stage.hours)}</span>
                </div>
              </div>
              <div className="h-3 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${widthPercentage}%`, backgroundColor: `hsl(var(--${stage.color}))` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-7 p-4 bg-secondary/50 rounded-2xl">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Nota:</strong> Estimativa baseada em <code>last_status_change_at</code> da oportunidade.
          Para cálculo preciso por etapa, é necessário histórico completo de mudanças de etapa do CRM.
        </p>
      </div>
    </div>
  );
}
