import { useMemo } from "react";
import { LossReason } from "@/hooks/useKommoData";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { XCircle, CheckCircle2, AlertCircle } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";
import { groupTopN, NAO_INFORMADO_LABEL } from "@/lib/group-top-n";
import { getPieColor } from "@/lib/pie-palette";

interface LossReasonsProps { lossReasons: LossReason[]; totalLost: number; }

export function LossReasons({ lossReasons, totalLost }: LossReasonsProps) {
  const distribution = useMemo(() => {
    if (totalLost === 0) return [];
    return lossReasons
      .map((lr) => ({
        name: lr.reason,
        count: lr.count,
        percentage: (lr.count / totalLost) * 100,
      }))
      .sort((a, b) => {
        if (a.name === NAO_INFORMADO_LABEL) return 1;
        if (b.name === NAO_INFORMADO_LABEL) return -1;
        return (b.count - a.count) || a.name.localeCompare(b.name);
      });
  }, [lossReasons, totalLost]);

  const grouped = useMemo(() => groupTopN(distribution, 6), [distribution]);
  const chartData = grouped.map((o) => ({ name: o.name, value: o.count }));

  const chartDescription = useMemo(() => {
    if (grouped.length === 0) return "Nenhuma oportunidade perdida no período.";
    const top = grouped.slice(0, 3).map((g) => `${g.name} ${g.percentage.toFixed(0)}%`).join(", ");
    return `Motivos de perda: gráfico de pizza com ${grouped.length} fatia${grouped.length === 1 ? "" : "s"}, totalizando ${totalLost} oportunidade${totalLost === 1 ? "" : "s"} perdida${totalLost === 1 ? "" : "s"}. Maiores motivos: ${top}.`;
  }, [grouped, totalLost]);

  const filled = distribution
    .filter((d) => d.name !== NAO_INFORMADO_LABEL)
    .reduce((s, d) => s + d.count, 0);
  const fillRate = totalLost > 0 ? (filled / totalLost) * 100 : 0;

  return (
    <div className="dashboard-section animate-slide-up h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title mb-0">
          <XCircle className="w-5 h-5 text-destructive" />
          Motivos de Perda
          <SectionTooltip text="Distribuição dos motivos para oportunidades marcadas como Perdidas. Mostra os 6 principais motivos; o restante é agrupado em 'Outras'. Perdas sem motivo registrado aparecem como 'Não informado'." />
        </h2>
        <div
          className="flex items-center gap-1.5 text-sm"
          aria-label={`Preenchimento ${fillRate > 50 ? "adequado" : "abaixo do recomendado"}: ${fillRate.toFixed(1)}%`}
        >
          <span className="text-muted-foreground hidden sm:inline">Preenchido:</span>
          {fillRate > 50
            ? <CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" />
            : <AlertCircle className="w-3.5 h-3.5 text-warning-ink" aria-hidden="true" />}
          <span className={`font-bold tabular-nums ${fillRate > 50 ? "text-success" : "text-warning-ink"}`}>
            {fillRate.toFixed(1)}%
          </span>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-muted-foreground text-sm text-center">
            Nenhuma oportunidade perdida no período.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-full h-56" role="img" aria-label={chartDescription}>
            {/* Total no centro — ANTES do chart p/ o tooltip ficar por cima */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold tabular-nums text-foreground leading-none">{totalLost}</span>
              <span className="text-[11px] text-muted-foreground mt-0.5">perdidos</span>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={getPieColor(d.name, i)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--raio-md)",
                    boxShadow: "var(--shadow-2)",
                    fontSize: 13,
                  }}
                  formatter={(v: number, name: string) => [`${v} perdido${v === 1 ? "" : "s"}`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="w-full space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
            {grouped.map((o, i) => (
              <div key={o.name} className="flex items-center justify-between px-2 py-1.5 bg-secondary/40 rounded-[var(--raio-md)]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getPieColor(o.name, i) }} />
                  <span className="text-xs font-semibold truncate" title={o.name}>{o.name}</span>
                </div>
                <span className="text-xs font-bold text-foreground tabular-nums ml-2 shrink-0">
                  {o.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
