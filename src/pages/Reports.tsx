import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { LayoutDashboard, GitBranch, Users, Target, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterSelect, MultiFilterSelect } from "@/components/dashboard/Header";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useReportSnapshots, DateBasis, ReportMonth, ReportMetrics } from "@/hooks/useReportSnapshots";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

type Fmt = "num" | "brl" | "pct";
interface MetricDef {
  id: string;
  label: string;
  fmt: Fmt;
  value: (m: ReportMetrics) => number;
  invert?: boolean;        // cair é bom (perda, receita perdida)
  showDirection?: boolean; // mostra seta ▲▼ colorida mesmo no modo Valores (taxas)
}

const taxaPerda = (m: ReportMetrics) => {
  const closed = m.won + m.lost;
  return closed > 0 ? (m.lost / closed) * 100 : 0;
};

// Catálogo por eixo — mesma foto, leitura diferente.
const CATALOG: Record<DateBasis, MetricDef[]> = {
  criacao: [
    { id: "leads", label: "Leads Criados", fmt: "num", value: (m) => m.leads },
    { id: "won", label: "Vendas", fmt: "num", value: (m) => m.won },
    { id: "wonRevenue", label: "Receita Ganha", fmt: "brl", value: (m) => m.wonRevenue },
    { id: "ticket", label: "Ticket Médio", fmt: "brl", value: (m) => m.ticket },
  ],
  fechamento: [
    { id: "leads", label: "Leads Fechados", fmt: "num", value: (m) => m.leads },
    { id: "won", label: "Vendas Ganhas", fmt: "num", value: (m) => m.won },
    { id: "taxaFechamento", label: "Taxa de Fechamento", fmt: "pct", value: (m) => m.winRate, showDirection: true },
    { id: "taxaPerda", label: "Taxa de Perda", fmt: "pct", value: taxaPerda, invert: true, showDirection: true },
    { id: "wonRevenue", label: "Receita Ganha", fmt: "brl", value: (m) => m.wonRevenue },
    { id: "lostRevenue", label: "Receita Perdida", fmt: "brl", value: (m) => m.lostRevenue, invert: true },
    { id: "lost", label: "Perdas", fmt: "num", value: (m) => m.lost, invert: true },
    { id: "ticket", label: "Ticket Médio", fmt: "brl", value: (m) => m.ticket },
  ],
};

const DEFAULT_VISIBLE: Record<DateBasis, string[]> = {
  criacao: ["leads", "won", "wonRevenue", "ticket"],
  fechamento: ["leads", "won", "taxaFechamento", "taxaPerda", "wonRevenue", "lostRevenue"],
};

const formatBRL = (v: number) =>
  v >= 100_000
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(v)
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

const fmtValue = (v: number, fmt: Fmt) =>
  fmt === "brl" ? formatBRL(v) : fmt === "pct" ? `${v.toFixed(1)}%` : new Intl.NumberFormat("pt-BR").format(v);

const monthLabel = (iso: string) => format(new Date(iso + "T12:00:00"), "MMM/yy", { locale: ptBR });

// Sparkline SVG minimalista.
function Sparkline({ values }: { values: number[] }) {
  const w = 88, h = 24, pad = 2;
  if (values.length < 2) return <div style={{ width: w, height: h }} />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Cor conforme direção, respeitando o sentido (invert = cair é bom).
function trendClass(curr: number, prev: number, invert?: boolean): string {
  if (prev === curr) return "text-muted-foreground";
  const up = curr > prev;
  const good = invert ? !up : up;
  return good ? "text-success" : "text-destructive";
}
function pctChange(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? "novo" : "—";
  const ch = ((curr - prev) / Math.abs(prev)) * 100;
  if (Math.abs(ch) < 0.1) return "0%";
  return `${ch > 0 ? "+" : ""}${ch.toFixed(0)}%`;
}

export default function Reports() {
  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?.id || null;
  const [dateBasis, setDateBasis] = useState<DateBasis>("fechamento");
  const [rangeMonths, setRangeMonths] = useState<number>(6);
  const [mode, setMode] = useState<"valores" | "variacao">("valores");
  const [visibleIds, setVisibleIds] = useState<string[]>(DEFAULT_VISIBLE.fechamento);
  const [chartMetric, setChartMetric] = useState<string>("wonRevenue");
  const [chartMetric2, setChartMetric2] = useState<string>(""); // 2ª métrica (eixo direito), opcional
  const [pipelineId, setPipelineId] = useState<string>("__all__");
  const [sellerIds, setSellerIds] = useState<string[]>([]); // vazio = todos os vendedores
  const [hoveredCol, setHoveredCol] = useState<number | null>(null); // coluna (mês) em foco

  // Persistência da visão (localStorage, por workspace): lembra a última configuração
  // sem botão. Hidrata ao trocar de conta e regrava a cada mudança relevante.
  const viewKey = wsId ? `kommo-report-view:${wsId}` : null;
  const hydrated = useRef(false);
  useEffect(() => {
    hydrated.current = false;
    if (!viewKey) return;
    try {
      const raw = localStorage.getItem(viewKey);
      if (raw) {
        const v = JSON.parse(raw);
        if (v.dateBasis === "criacao" || v.dateBasis === "fechamento") setDateBasis(v.dateBasis);
        if (typeof v.rangeMonths === "number") setRangeMonths(v.rangeMonths);
        if (v.mode === "valores" || v.mode === "variacao") setMode(v.mode);
        if (Array.isArray(v.visibleIds)) setVisibleIds(v.visibleIds);
        if (typeof v.chartMetric === "string") setChartMetric(v.chartMetric);
        if (typeof v.chartMetric2 === "string") setChartMetric2(v.chartMetric2);
        if (typeof v.pipelineId === "string") setPipelineId(v.pipelineId);
        if (Array.isArray(v.sellerIds)) setSellerIds(v.sellerIds);
      }
    } catch { /* visão inválida: ignora e segue com os defaults */ }
    hydrated.current = true;
  }, [viewKey]);
  useEffect(() => {
    if (!viewKey || !hydrated.current) return;
    try {
      localStorage.setItem(viewKey, JSON.stringify({
        dateBasis, rangeMonths, mode, visibleIds, chartMetric, chartMetric2, pipelineId, sellerIds,
      }));
    } catch { /* quota/priv mode: ignora */ }
  }, [viewKey, dateBasis, rangeMonths, mode, visibleIds, chartMetric, chartMetric2, pipelineId, sellerIds]);

  // Nomes de funil e vendedor (para os seletores) — buscados ao vivo, fora da foto.
  const { data: pipelines = [] } = useQuery({
    queryKey: ["report-pipelines", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await supabase.from("pipelines").select("kommo_id,name").eq("workspace_id", wsId!);
      return (data || []) as { kommo_id: string; name: string }[];
    },
  });
  const { data: users = [] } = useQuery({
    queryKey: ["report-users", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await supabase.from("users").select("kommo_id,name").eq("workspace_id", wsId!);
      return (data || []) as { kommo_id: string; name: string }[];
    },
  });
  const pipelineName = useMemo(() => new Map(pipelines.map((p) => [p.kommo_id, p.name])), [pipelines]);
  const userName = useMemo(() => new Map(users.map((u) => [u.kommo_id, u.name])), [users]);

  // ===== Metas (meta fixa mensal por métrica) =====
  // Guardadas em kommo.dashboard_settings.report_goals, chaveadas por "<eixo>:<metricId>".
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Record<string, string>>({}); // edição (strings dos inputs)
  const [savingGoals, setSavingGoals] = useState(false);
  const goalKey = (id: string) => `${dateBasis}:${id}`;
  const { data: goals = {}, refetch: refetchGoals } = useQuery({
    queryKey: ["report-goals", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await supabase.from("dashboard_settings").select("report_goals").eq("workspace_id", wsId!).maybeSingle();
      const raw = (data as any)?.report_goals;
      return (raw && typeof raw === "object" ? raw : {}) as Record<string, number>;
    },
  });
  const saveGoals = async () => {
    if (!wsId) return;
    setSavingGoals(true);
    try {
      // Mescla o rascunho (só as chaves editadas) sobre as metas atuais; vazio remove.
      const next: Record<string, number> = { ...goals };
      for (const [k, v] of Object.entries(goalDraft)) {
        const n = Number(String(v).replace(/\./g, "").replace(",", "."));
        if (v === "" || !Number.isFinite(n) || n <= 0) delete next[k];
        else next[k] = n;
      }
      const { error } = await supabase.from("dashboard_settings")
        .upsert({ workspace_id: wsId, report_goals: next } as any, { onConflict: "workspace_id" });
      if (error) throw error;
      toast.success("Metas salvas");
      setGoalDraft({});
      refetchGoals();
    } catch (e) {
      toast.error("Erro ao salvar metas", { description: (e as Error).message });
    } finally {
      setSavingGoals(false);
    }
  };

  const { months: rawMonths, isLoading, error } = useReportSnapshots(wsId, dateBasis, pipelineId);

  // Aplica os vendedores selecionados: soma os sub-blocos bySeller escolhidos, mês a
  // mês, recalculando ticket (receita/vendas) e winRate (vendas/fechados) — proporções
  // não podem ser somadas. Vazio = todos (usa a foto agregada como está).
  const months: ReportMonth[] = useMemo(() => {
    if (sellerIds.length === 0) return rawMonths;
    return rawMonths.map((mo) => {
      const acc = { leads: 0, won: 0, wonRevenue: 0, lost: 0, lostRevenue: 0 };
      for (const id of sellerIds) {
        const s = mo.metrics.bySeller?.[id];
        if (!s) continue;
        acc.leads += s.leads; acc.won += s.won; acc.wonRevenue += s.wonRevenue;
        acc.lost += s.lost; acc.lostRevenue += s.lostRevenue;
      }
      const closed = acc.won + acc.lost;
      return {
        ...mo,
        metrics: {
          ...acc,
          ticket: acc.won > 0 ? acc.wonRevenue / acc.won : 0,
          winRate: closed > 0 ? (acc.won / closed) * 100 : 0,
        },
      };
    });
  }, [rawMonths, sellerIds]);

  // Vendedores disponíveis (união dos sub-blocos ao longo dos meses).
  const sellerOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const mo of rawMonths) for (const id of Object.keys(mo.metrics.bySeller ?? {})) ids.add(id);
    return [...ids]
      .map((id) => ({ id, name: id === "__none__" ? "Não atribuído" : (userName.get(id) || `Usuário ${id.slice(0, 6)}`) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rawMonths, userName]);

  // Catálogo = métricas do eixo + (na aba Comercial) taxas de etapa derivadas das fotos.
  const catalog = useMemo<MetricDef[]>(() => {
    const base = CATALOG[dateBasis];
    if (dateBasis !== "criacao") return base;
    const latest = [...months].reverse().find((mo) => (mo.metrics.reached?.length ?? 0) > 0);
    const reachDefs: MetricDef[] = (latest?.metrics.reached ?? []).map((r) => ({
      id: `reach:${r.id}`,
      label: `Taxa de ${r.label}`,
      fmt: "pct",
      showDirection: true,
      value: (m: ReportMetrics) => {
        const item = m.reached?.find((x) => x.id === r.id);
        return m.leads > 0 && item ? (item.count / m.leads) * 100 : 0;
      },
    }));
    return [...base, ...reachDefs];
  }, [dateBasis, months]);

  const onAxisChange = (v: string) => {
    const axis = v as DateBasis;
    setDateBasis(axis);
    setVisibleIds(DEFAULT_VISIBLE[axis]);
    seenReach.current.clear();
    if (!CATALOG[axis].some((m) => m.id === chartMetric)) setChartMetric(CATALOG[axis][0].id);
    if (chartMetric2 && !CATALOG[axis].some((m) => m.id === chartMetric2)) setChartMetric2("");
  };

  // Liga automaticamente as taxas de etapa recém-configuradas (só na 1ª vez que aparecem).
  const seenReach = useRef<Set<string>>(new Set());
  const reachIds = useMemo(() => catalog.filter((m) => m.id.startsWith("reach:")).map((m) => m.id), [catalog]);
  useEffect(() => {
    const fresh = reachIds.filter((id) => !seenReach.current.has(id));
    if (fresh.length) {
      fresh.forEach((id) => seenReach.current.add(id));
      setVisibleIds((prev) => [...prev, ...fresh.filter((id) => !prev.includes(id))]);
    }
  }, [reachIds]);

  const shown: ReportMonth[] = useMemo(() => months.slice(-rangeMonths), [months, rangeMonths]);
  const visibleMetrics = catalog.filter((m) => visibleIds.includes(m.id));
  const goalsForAxis = useMemo(() => Object.keys(goals).filter((k) => k.startsWith(`${dateBasis}:`)).length, [goals, dateBasis]);

  const chartDef = catalog.find((m) => m.id === chartMetric) || catalog[0];
  const chartDef2 = chartMetric2 ? catalog.find((m) => m.id === chartMetric2) : undefined;
  const chartData = useMemo(
    () => shown.map((mo) => ({
      mes: monthLabel(mo.month),
      v1: chartDef.value(mo.metrics),
      ...(chartDef2 ? { v2: chartDef2.value(mo.metrics) } : {}),
    })),
    [shown, chartDef, chartDef2],
  );
  const axisFmt = (fmt: Fmt) => (v: number | string) =>
    fmt === "brl" ? formatBRL(Number(v)) : fmt === "pct" ? `${v}%` : String(v);

  if (!activeWorkspace) {
    return <div className="p-6 text-muted-foreground">Selecione uma conta para ver os relatórios.</div>;
  }

  const hasData = shown.some((m) => m.metrics.leads > 0 || m.metrics.won > 0 || m.metrics.lost > 0);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Barra de filtros fixa no topo (mesmo padrão do dashboard) */}
      <div className="sticky top-0 -mx-6 -mt-6 mb-2 z-30 bg-card/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-end gap-2 overflow-x-auto pl-14 pr-4 py-3 min-h-16">
          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">Período</span>
            <div className="flex items-center gap-1.5 h-8">
              {[3, 6, 12].map((n) => (
                <button key={n} onClick={() => setRangeMonths(n)}
                  className={cn("px-2.5 h-8 rounded-md text-xs font-semibold border transition-colors",
                    rangeMonths === n ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:bg-accent/50")}>
                  {n}m
                </button>
              ))}
            </div>
          </div>

          <Separator orientation="vertical" className="h-10 hidden md:block self-end mb-1" />

          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">Funil de vendas</span>
            <FilterSelect
              value={pipelineId === "__all__" ? null : pipelineId}
              onChange={(v) => setPipelineId(v ?? "__all__")}
              placeholder="Funil"
              icon={GitBranch}
              options={pipelines.map((p) => ({ id: p.kommo_id, name: p.name }))}
            />
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">Vendedor</span>
            <MultiFilterSelect
              values={sellerIds}
              onChange={setSellerIds}
              placeholder="Vendedor"
              pluralLabel="vendedores"
              icon={Users}
              options={sellerOptions}
            />
          </div>
        </div>
      </div>

      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
            <p className="text-muted-foreground">{activeWorkspace.name} · comparação mês a mês (fotos congeladas)</p>
          </div>
          <Tabs value={dateBasis} onValueChange={onAxisChange}>
            <TabsList className="h-11 gap-1 p-1.5">
              <TabsTrigger value="criacao" className="px-5 py-2 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">Comercial</TabsTrigger>
              <TabsTrigger value="fechamento" className="px-5 py-2 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">Financeiro</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Button variant="outline" size="sm" className="h-8 px-3 gap-1.5 text-xs" asChild>
          <Link to="/dashboard"><LayoutDashboard className="w-3.5 h-3.5" /> Ver dashboard (ao vivo)</Link>
        </Button>
      </div>

      {isLoading && <div className="dashboard-section text-muted-foreground">Carregando fotos…</div>}
      {error && <div className="dashboard-section text-destructive">Erro: {error}</div>}

      {!isLoading && !error && (!hasData ? (
        <div className="dashboard-section text-center py-10">
          <p className="text-muted-foreground">Ainda não há fotos com movimento no período selecionado.</p>
          <p className="text-xs text-muted-foreground mt-1">As fotos são geradas automaticamente; aumente o período ou aguarde o próximo fechamento.</p>
        </div>
      ) : (
        <>
          {/* Tabela de comparação — zebra + âncora no mês atual + realce de coluna no hover */}
          <div className="dashboard-section p-0 overflow-hidden">
            {/* Metas (colapsável): meta fixa mensal por métrica — o atingimento aparece na coluna "atual". */}
            <div className="border-b border-border">
              <button
                onClick={() => setGoalsOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-accent/40 transition-colors">
                <span className="flex items-center gap-2">
                  <Target className="w-3.5 h-3.5 text-primary-ink" /> Metas
                  {goalsForAxis > 0 && (
                    <span className="rounded-full bg-primary/10 text-primary-ink px-1.5 py-0.5 text-[10px] font-medium">{goalsForAxis} definida{goalsForAxis > 1 ? "s" : ""}</span>
                  )}
                  <span className="font-normal text-muted-foreground/70">· alvo mensal por métrica</span>
                </span>
                <ChevronDown className={cn("w-4 h-4 transition-transform", goalsOpen && "rotate-180")} />
              </button>
              {goalsOpen && (
                <div className="px-4 pb-3 pt-1 flex flex-wrap items-end gap-3">
                  {visibleMetrics.map((met) => {
                    const k = goalKey(met.id);
                    const val = goalDraft[k] ?? (goals[k] != null ? String(goals[k]) : "");
                    return (
                      <div key={met.id} className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">
                          {met.label}{met.fmt === "brl" ? " (R$)" : met.fmt === "pct" ? " (%)" : ""}
                        </label>
                        <Input
                          value={val}
                          inputMode="decimal"
                          placeholder="—"
                          onChange={(e) => setGoalDraft((d) => ({ ...d, [k]: e.target.value }))}
                          className="h-8 w-28 text-sm" />
                      </div>
                    );
                  })}
                  <Button size="sm" className="h-8 text-xs" disabled={savingGoals || Object.keys(goalDraft).length === 0} onClick={saveGoals}>
                    {savingGoals ? "Salvando…" : "Salvar metas"}
                  </Button>
                </div>
              )}
            </div>
            {/* Controles da tabela: leitura + quais métricas mostrar (agem aqui, então moram aqui) */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Leitura:</span>
                {(["valores", "variacao"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={cn("px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors",
                      mode === m ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:bg-accent/50")}>
                    {m === "valores" ? "Valores" : "Variação"}
                  </button>
                ))}
              </div>
              <div className="w-px h-5 bg-border hidden sm:block" />
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-muted-foreground">Métricas:</span>
                {catalog.map((m) => {
                  const on = visibleIds.includes(m.id);
                  return (
                    <button key={m.id} aria-pressed={on}
                      onClick={() => setVisibleIds((p) => on ? p.filter((k) => k !== m.id) : [...p, m.id])}
                      className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                        on ? "bg-primary/10 border-primary/40 text-primary-ink" : "border-border/60 text-muted-foreground hover:bg-accent/50")}>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" onMouseLeave={() => setHoveredCol(null)}>
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th className="sticky left-0 z-10 bg-inherit text-left font-semibold text-muted-foreground px-4 py-3 min-w-[160px]">Métrica</th>
                    {shown.map((mo, i) => {
                      const isLast = i === shown.length - 1;
                      return (
                        <th key={mo.month}
                          onMouseEnter={() => setHoveredCol(i)}
                          className={cn("text-right font-semibold px-4 py-3 whitespace-nowrap border-l border-border/40 transition-colors",
                            hoveredCol === i ? "bg-primary/10" : isLast ? "bg-primary/5" : "",
                            isLast ? "text-foreground" : "text-muted-foreground")}
                          title={`Foto de ${format(new Date(mo.frozenAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}`}>
                          <span className="capitalize">{monthLabel(mo.month)}</span>
                          {isLast && <span className="ml-1 text-[10px] font-normal text-primary">atual</span>}
                          {mo.isPartial && <span className="ml-1 text-[10px] text-accent-foreground font-normal">(parcial)</span>}
                        </th>
                      );
                    })}
                    <th className="text-right font-semibold text-muted-foreground px-4 py-3 border-l border-border/40">Tendência</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMetrics.map((met, rowIdx) => {
                    const series = shown.map((mo) => met.value(mo.metrics));
                    return (
                      <tr key={met.id}
                        className={cn("border-b border-border/60 last:border-0 transition-colors hover:bg-accent",
                          rowIdx % 2 === 1 ? "bg-muted" : "bg-card")}>
                        <td className="sticky left-0 z-10 bg-inherit font-medium px-4 py-3 whitespace-nowrap">{met.label}</td>
                        {shown.map((mo, i) => {
                          const v = met.value(mo.metrics);
                          const prev = i > 0 ? met.value(shown[i - 1].metrics) : null;
                          const variacao = mode === "variacao" && prev !== null;
                          const isLast = i === shown.length - 1;
                          return (
                            <td key={mo.month}
                              onMouseEnter={() => setHoveredCol(i)}
                              className={cn("text-right px-4 py-3 whitespace-nowrap tabular-nums border-l border-border/40 transition-colors",
                                hoveredCol === i ? "bg-primary/10" : isLast ? "bg-primary/5" : "",
                                variacao ? trendClass(v, prev!, met.invert) : "text-foreground")}>
                              {variacao ? pctChange(v, prev!) : fmtValue(v, met.fmt)}
                              {!variacao && met.showDirection && prev !== null && v !== prev && (
                                <span className={cn("ml-1 text-[10px]", trendClass(v, prev, met.invert))}>{v > prev ? "▲" : "▼"}</span>
                              )}
                              {isLast && !variacao && (() => {
                                const g = goals[goalKey(met.id)];
                                if (!g || g <= 0) return null;
                                const pct = (v / g) * 100;
                                const good = met.invert ? v <= g : v >= g; // em métricas invertidas, ficar abaixo é bom
                                return (
                                  <div className={cn("text-[10px] font-normal mt-0.5", good ? "text-success" : "text-muted-foreground")}>
                                    {pct.toFixed(0)}% da meta
                                  </div>
                                );
                              })()}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-right border-l border-border/40">
                          <div className={cn("inline-flex justify-end", trendClass(series[series.length - 1], series[0], met.invert))}>
                            <Sparkline values={series} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Gráfico de linha (1 ou 2 métricas, eixos independentes) */}
          <div className="dashboard-section">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="section-title mb-0">Evolução no tempo</h2>
              <div className="flex items-center gap-2">
                <Select value={chartMetric} onValueChange={setChartMetric}>
                  <SelectTrigger className="h-8 text-xs font-medium border-border/60 hover:bg-accent/50 border-primary/40 bg-primary/5 text-foreground gap-2 px-3 w-auto min-w-[150px] max-w-[220px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    {catalog.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">vs</span>
                <Select value={chartMetric2 || "__none__"} onValueChange={(v) => setChartMetric2(v === "__none__" ? "" : v)}>
                  <SelectTrigger className={cn("h-8 text-xs font-medium border-border/60 hover:bg-accent/50 gap-2 px-3 w-auto min-w-[150px] max-w-[220px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                    chartMetric2 && "border-primary/40 bg-primary/5 text-foreground")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    <SelectItem value="__none__">— nenhuma —</SelectItem>
                    {catalog.filter((m) => m.id !== chartMetric).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} className="capitalize" />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickFormatter={axisFmt(chartDef.fmt)} width={chartDef.fmt === "brl" ? 64 : 40} />
                  {chartDef2 && (
                    <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--funnel-3))", fontSize: 12 }}
                      tickFormatter={axisFmt(chartDef2.fmt)} width={chartDef2.fmt === "brl" ? 64 : 40} />
                  )}
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
                    formatter={(v: number, name: string) => {
                      const def = name === "v2" ? chartDef2! : chartDef;
                      return [fmtValue(Number(v), def.fmt), def.label];
                    }} />
                  <Legend formatter={(name) => (name === "v2" ? chartDef2?.label : chartDef.label) ?? name} />
                  {goals[goalKey(chartMetric)] > 0 && (
                    <ReferenceLine yAxisId="left" y={goals[goalKey(chartMetric)]} stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeOpacity={0.55}
                      label={{ value: "Meta", position: "insideTopLeft", fill: "hsl(var(--primary-ink))", fontSize: 11 }} />
                  )}
                  {chartDef2 && goals[goalKey(chartMetric2)] > 0 && (
                    <ReferenceLine yAxisId="right" y={goals[goalKey(chartMetric2)]} stroke="hsl(var(--funnel-3))" strokeDasharray="4 4" strokeOpacity={0.55}
                      label={{ value: "Meta", position: "insideTopRight", fill: "hsl(var(--funnel-3-ink))", fontSize: 11 }} />
                  )}
                  <Line yAxisId="left" type="monotone" dataKey="v1" name="v1" stroke="hsl(var(--primary))" strokeWidth={2.5}
                    dot={{ r: 3, fill: "hsl(var(--primary))" }} activeDot={{ r: 5 }} />
                  {chartDef2 && (
                    <Line yAxisId="right" type="monotone" dataKey="v2" name="v2" stroke="hsl(var(--funnel-3))" strokeWidth={2.5}
                      dot={{ r: 3, fill: "hsl(var(--funnel-3))" }} activeDot={{ r: 5 }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ))}
    </div>
  );
}
