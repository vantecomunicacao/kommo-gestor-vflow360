import { useMemo } from "react";
import { DailyLead } from "@/hooks/useKommoData";
import { CalendarRange, X } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";
import { BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

interface MonthlyResultsProps {
  dailyLeads: DailyLead[];
  /** Mês selecionado ("YYYY-MM"), pra destacar a barra e filtrar o gráfico diário abaixo. */
  selectedMonth?: string | null;
  onSelectMonth?: (month: string | null) => void;
}

interface MonthBucket { month: string; label: string; won: number; lost: number; }

const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });

export function MonthlyResults({ dailyLeads, selectedMonth, onSelectMonth }: MonthlyResultsProps) {
  const months = useMemo<MonthBucket[]>(() => {
    const byMonth = new Map<string, MonthBucket>();
    for (const d of dailyLeads || []) {
      const month = d.date.slice(0, 7); // "YYYY-MM"
      const bucket = byMonth.get(month) ?? {
        month,
        label: MONTH_LABEL.format(new Date(d.date + "T12:00:00Z")).replace(".", ""),
        won: 0,
        lost: 0,
      };
      bucket.won += d.won;
      bucket.lost += d.lost;
      byMonth.set(month, bucket);
    }
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [dailyLeads]);

  const totalWon = months.reduce((s, m) => s + m.won, 0);
  const totalLost = months.reduce((s, m) => s + m.lost, 0);

  const chartDescription = useMemo(() => {
    if (months.length === 0) return "Nenhum fechamento no período.";
    const perMonth = months.map((m) => `${m.label}: ${m.won} ganho${m.won === 1 ? "" : "s"}, ${m.lost} perdido${m.lost === 1 ? "" : "s"}`).join("; ");
    return `Fechamentos por mês: ${perMonth}.`;
  }, [months]);

  return (
    <div className="dashboard-section animate-slide-up h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title mb-0">
          <CalendarRange className="w-5 h-5 text-primary-ink" />
          Vendas e Perdas por Mês
          <SectionTooltip text="Fechamentos (ganho + perdido) agrupados pelo mês de fechamento. Clique num mês para ver o detalhe por dia. Verde = ganho, vermelho = perdido." />
        </h2>
        {selectedMonth && (
          <button
            type="button"
            onClick={() => onSelectMonth?.(null)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Limpar
          </button>
        )}
      </div>

      {months.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-muted-foreground text-sm text-center">Nenhum fechamento no período.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="w-full h-56" role="img" aria-label={chartDescription}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} barCategoryGap="30%">
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12, fontWeight: 500 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} allowDecimals={false} />
                <Tooltip<number, string>
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--raio-md)",
                    boxShadow: "var(--shadow-2)",
                    fontSize: 13,
                  }}
                  formatter={(v, n) => n === "won" ? [`${v} ganho${v === 1 ? "" : "s"}`, "Ganho"] : [`${v} perdido${v === 1 ? "" : "s"}`, "Perdido"]}
                />
                <Bar
                  dataKey="won"
                  stackId="closures"
                  radius={[0, 0, 0, 0]}
                  cursor={onSelectMonth ? "pointer" : undefined}
                  onClick={(entry: MonthBucket) => onSelectMonth?.(selectedMonth === entry.month ? null : entry.month)}
                >
                  {months.map((m) => (
                    <Cell key={m.month} fill="hsl(var(--success))" opacity={!selectedMonth || selectedMonth === m.month ? 0.9 : 0.3} />
                  ))}
                </Bar>
                <Bar
                  dataKey="lost"
                  stackId="closures"
                  radius={[8, 8, 0, 0]}
                  cursor={onSelectMonth ? "pointer" : undefined}
                  onClick={(entry: MonthBucket) => onSelectMonth?.(selectedMonth === entry.month ? null : entry.month)}
                >
                  {months.map((m) => (
                    <Cell key={m.month} fill="hsl(var(--destructive))" opacity={!selectedMonth || selectedMonth === m.month ? 0.9 : 0.3} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="w-full flex items-center justify-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "hsl(var(--success))" }} />
              <span className="font-semibold text-foreground">{totalWon} ganho{totalWon === 1 ? "" : "s"}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "hsl(var(--destructive))" }} />
              <span className="font-semibold text-foreground">{totalLost} perdido{totalLost === 1 ? "" : "s"}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
