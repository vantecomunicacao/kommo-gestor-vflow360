import { useMemo } from "react";
import { LeadOrigin } from "@/hooks/useKommoData";
import { Compass, Trophy, Settings as SettingsIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { SectionTooltip } from "./SectionTooltip";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { groupTopN } from "@/lib/group-top-n";
import { getPieColor } from "@/lib/pie-palette";

type Mode = "leads" | "wins";

interface OriginsCardProps {
  mode: Mode;
  distribution: LeadOrigin[];
  fillRate: number;
  /** Total do universo (leads do período, ou vendas ganhas) — para a fatia "Não preenchido". */
  total?: number;
  configured: boolean;
  /** Mapa nome→cor compartilhado para manter a mesma origem na mesma cor entre cards. */
  colorMap?: Record<string, string>;
}

const UNFILLED_LABEL = "Não preenchido";
const UNFILLED_COLOR = "hsl(220 13% 82%)"; // cinza neutro

const COPY: Record<Mode, {
  icon: typeof Compass;
  title: string;
  tooltip: string;
  unitLabel: string;
  emptyData: string;
  notConfiguredText: string;
  showCta: boolean;
}> = {
  leads: {
    icon: Compass,
    title: "Origem dos leads",
    tooltip: "Origem por UTM Source + Campaign (ou o que houver). Sem UTM, usa a fonte do lead; sem nada, 'Não identificado'. Mostra as 6 maiores; o restante vira 'Outras'.",
    unitLabel: "leads",
    emptyData: "Nenhum lead no período.",
    notConfiguredText: "Mapeie o UTM Source nas configurações para visualizar a origem dos leads.",
    showCta: true,
  },
  wins: {
    icon: Trophy,
    title: "Origem das vendas",
    tooltip: "Origem das vendas ganhas por UTM Source + Campaign (ou o que houver). Sem UTM, usa a fonte do lead; sem nada, 'Não identificado'. Mostra as 6 maiores; o restante vira 'Outras'.",
    unitLabel: "vendas",
    emptyData: "Nenhuma venda ganha no período.",
    notConfiguredText: "Configure o campo UTM Source nas configurações para visualizar de onde vêm suas vendas.",
    showCta: true,
  },
};

export function OriginsCard({ mode, distribution, fillRate, total, configured, colorMap }: OriginsCardProps) {
  const copy = COPY[mode];
  const title = copy.title;
  const unitLabel = copy.unitLabel;
  const Icon = copy.icon;
  const colorFor = (name: string, i: number) =>
    name === UNFILLED_LABEL ? UNFILLED_COLOR : (colorMap?.[name] ?? getPieColor(name, i));

  const grouped = useMemo(() => groupTopN(distribution, 6), [distribution]);

  // Fatia cinza "Não preenchido": total do universo menos os que têm origem.
  const filledCount = useMemo(() => grouped.reduce((s, o) => s + o.count, 0), [grouped]);
  const unfilledCount = Math.max(0, (total ?? filledCount) - filledCount);
  const centerTotal = total ?? filledCount;

  const chartData = [
    ...grouped.map((o) => ({ name: o.name, value: o.count })),
    ...(unfilledCount > 0 ? [{ name: UNFILLED_LABEL, value: unfilledCount }] : []),
  ];

  const chartDescription = useMemo(() => {
    if (grouped.length === 0) return copy.emptyData;
    const total = grouped.reduce((sum, g) => sum + g.count, 0);
    const top = grouped.slice(0, 3).map((g) => `${g.name} ${g.percentage.toFixed(0)}%`).join(", ");
    return `${title}: gráfico de pizza com ${grouped.length} fatia${grouped.length === 1 ? "" : "s"}, totalizando ${total} ${unitLabel}. Maiores: ${top}.`;
  }, [grouped, copy, title, unitLabel]);

  if (!configured) {
    return (
      <div className="dashboard-section animate-slide-up h-full">
        <h2 className="section-title">
          <Icon className="w-5 h-5 text-primary-ink" />
          {title}
        </h2>
        <div className="flex flex-col items-center justify-center text-center py-10 gap-3">
          <p className="text-sm text-muted-foreground max-w-md">
            {copy.notConfiguredText}
          </p>
          {copy.showCta && (
            <Link
              to="/settings/dashboard"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary-ink hover:underline"
            >
              <SettingsIcon className="w-4 h-4" />
              Configurar campos UTM
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-section animate-slide-up h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title mb-0">
          <Icon className="w-5 h-5 text-primary-ink" />
          {title}
          <SectionTooltip text={copy.tooltip} />
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
            {copy.emptyData}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-full h-56" role="img" aria-label={chartDescription}>
            {/* Número total no centro do donut — ANTES do chart p/ o tooltip ficar por cima */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold tabular-nums text-foreground leading-none">{centerTotal}</span>
              <span className="text-[11px] text-muted-foreground mt-0.5">{copy.unitLabel}</span>
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
                    <Cell key={i} fill={colorFor(d.name, i)} />
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
                  formatter={(v: number, name: string) => [`${v} ${copy.unitLabel}`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="w-full space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
            {grouped.map((o, i) => (
              <div key={o.name} className="flex items-center justify-between px-2 py-1.5 bg-secondary/40 rounded-[var(--raio-md)]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorFor(o.name, i) }} />
                  <span className="text-xs font-semibold truncate" title={o.name}>{o.name}</span>
                </div>
                <span className="text-xs font-bold text-foreground tabular-nums ml-2 shrink-0">
                  {o.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
            {unfilledCount > 0 && (
              <div className="flex items-center justify-between px-2 py-1.5 bg-secondary/40 rounded-[var(--raio-md)]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: UNFILLED_COLOR }} />
                  <span className="text-xs font-semibold truncate text-muted-foreground" title={UNFILLED_LABEL}>{UNFILLED_LABEL}</span>
                </div>
                <span className="text-xs font-bold text-muted-foreground tabular-nums ml-2 shrink-0">
                  {((unfilledCount / centerTotal) * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
