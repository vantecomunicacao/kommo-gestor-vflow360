import { Fragment, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, LabelList } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { formatBRL } from "@/lib/format";
import type { AnalysisMetrics, PeriodMetrics } from "@/hooks/useDashboardAnalysis";

interface Props {
  result: string;
  metrics: AnalysisMetrics | null;
  params?: Record<string, unknown> | null;
}

function fmtDay(v: unknown): string {
  if (typeof v !== "string" || !v) return "—";
  try { return format(parseISO(v), "dd/MM/yy"); } catch { return v; }
}

// -------- markdown leve (sem dependência) --------
// Suporta: "## TÍTULO", "### sub", "- bullet", "1. item", **negrito**, parágrafos.
function renderInline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={`${keyBase}-${i}`} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
      : <Fragment key={`${keyBase}-${i}`}>{p}</Fragment>,
  );
}

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: JSX.Element[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${key++}`} className="space-y-1.5 pl-1">
        {list.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>{renderInline(it, `li-${key}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); continue; }
    const h2 = line.match(/^##\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);
    const bullet = line.match(/^[-*]\s+(.*)/);
    const num = line.match(/^\d+\.\s+(.*)/);

    if (h2 || h1) {
      flushList();
      blocks.push(
        <h4 key={`h-${key++}`} className="mt-4 mb-1.5 border-b border-border pb-1 text-xs font-bold uppercase tracking-wide text-primary first:mt-0">
          {(h2 || h1)![1].toUpperCase()}
        </h4>,
      );
    } else if (h3) {
      flushList();
      blocks.push(<h5 key={`h-${key++}`} className="mt-2 mb-1 text-sm font-semibold text-foreground">{h3[1]}</h5>);
    } else if (bullet || num) {
      list.push((bullet || num)![1]);
    } else {
      flushList();
      blocks.push(<p key={`p-${key++}`} className="text-sm leading-relaxed text-muted-foreground">{renderInline(line, `p-${key}`)}</p>);
    }
  }
  flushList();
  return <div className="space-y-1">{blocks}</div>;
}

// -------- KPIs --------
function wonCount(m: PeriodMetrics | null): number {
  return m?.funnelStages?.find((s) => s.id === "venda_ganha")?.count ?? 0;
}
function delta(cur: number, prev: number | undefined): { pct: number | null; dir: "up" | "down" | "flat" } {
  if (prev == null || prev === 0) return { pct: null, dir: "flat" };
  const pct = ((cur - prev) / prev) * 100;
  return { pct, dir: pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat" };
}

function Kpi({ label, value, cur, prev, invert }: { label: string; value: string; cur: number; prev?: number; invert?: boolean }) {
  const d = delta(cur, prev);
  const good = d.dir === "flat" ? null : invert ? d.dir === "down" : d.dir === "up";
  const Icon = d.dir === "up" ? TrendingUp : d.dir === "down" ? TrendingDown : Minus;
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-foreground">{value}</p>
      {d.pct != null && (
        <span className={`mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium ${good == null ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          <Icon className="h-3 w-3" />{Math.abs(d.pct).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export default function AnalysisReport({ result, metrics, params }: Props) {
  const p = metrics?.principal ?? null;
  const c = metrics?.comparacao ?? null;

  const funnelData = useMemo(
    () => (p?.funnelStages || []).map((s) => ({ name: s.name, count: s.count })),
    [p],
  );

  const pr = (params || {}) as Record<string, unknown>;
  const funil = (pr.pipelineName as string) || "Todos os funis";
  const eixo = pr.dateBasis === "fechamento" ? "por fechamento" : "por criação";
  const periodo = `${fmtDay(pr.startDate)} – ${fmtDay(pr.endDate)}`;
  const compara = pr.compare ? `vs ${fmtDay(pr.compareStart)} – ${fmtDay(pr.compareEnd)}` : "";

  return (
    <div className="space-y-4">
      {/* Cabeçalho do relatório */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
        <p className="text-sm font-bold uppercase tracking-wide text-foreground">{funil}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {periodo}{compara && <span className="text-primary"> {compara}</span>} · {eixo}
        </p>
      </div>

      {/* KPIs */}
      {p && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Leads" value={String(p.totalLeads)} cur={p.totalLeads} prev={c?.totalLeads} />
          <Kpi label="Vendas" value={String(wonCount(p))} cur={wonCount(p)} prev={c ? wonCount(c) : undefined} />
          <Kpi label="Receita" value={formatBRL(p.monetary?.won ?? 0)} cur={p.monetary?.won ?? 0} prev={c?.monetary?.won} />
          <Kpi label="Perdidos" value={String(p.lostLeads)} cur={p.lostLeads} prev={c?.lostLeads} invert />
        </div>
      )}

      {/* Gráfico de funil */}
      {funnelData.length > 0 && (
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-primary">Funil — {p?.totalLeads ?? 0} leads</p>
          <ResponsiveContainer width="100%" height={Math.max(120, funnelData.length * 38)}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 4, right: 28, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {funnelData.map((_, i) => (
                  <Cell key={i} fill={`hsl(var(--primary) / ${0.45 + (i / Math.max(1, funnelData.length - 1)) * 0.55})`} />
                ))}
                <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Texto da análise (markdown) */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <Markdown text={result} />
      </div>
    </div>
  );
}
