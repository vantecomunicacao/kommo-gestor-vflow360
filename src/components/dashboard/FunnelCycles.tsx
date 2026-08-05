import { Trophy, XCircle } from "lucide-react";

interface FunnelCyclesProps {
  cycleToWonDays: number;
  cycleToWonSample: number;
  cycleToLostDays: number;
  cycleToLostSample: number;
}

const formatDays = (d: number) => {
  if (!d || d <= 0) return "—";
  return `${d.toFixed(1).replace(".", ",")} dias`;
};

export function FunnelCycles({
  cycleToWonDays,
  cycleToWonSample,
  cycleToLostDays,
  cycleToLostSample,
}: FunnelCyclesProps) {
  return (
    <div className="h-full bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Trophy className="w-3.5 h-3.5 text-success" />
            Ciclo até a venda
          </div>
          <div className="text-2xl font-bold text-success tabular-nums">
            {formatDays(cycleToWonDays)}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cycleToWonSample > 0
              ? `${cycleToWonSample} venda${cycleToWonSample === 1 ? "" : "s"} no período`
              : "Sem amostra"}
          </p>
        </div>

        <div className="pt-4 border-t border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <XCircle className="w-3.5 h-3.5 text-destructive" />
            Ciclo até a perda
          </div>
          <div className="text-2xl font-bold text-destructive tabular-nums">
            {formatDays(cycleToLostDays)}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cycleToLostSample > 0
              ? `${cycleToLostSample} perda${cycleToLostSample === 1 ? "" : "s"} no período`
              : "Sem amostra"}
          </p>
        </div>
      </div>
    </div>
  );
}
