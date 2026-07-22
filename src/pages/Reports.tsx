import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { LayoutDashboard, GitBranch, Users, Target, ChevronDown, Printer, GripVertical, Save, RotateCcw, MoreHorizontal, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FilterSelect, MultiFilterSelect } from "@/components/dashboard/Header";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AxisTabs } from "@/components/AxisTabs";
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
  desc?: string;           // explicação curta (tooltip na pill e na linha)
  tag?: string;            // tagzinha ao lado do nome (ex.: "coorte", "win rate")
}

// Catálogo por eixo — mesma foto, leitura diferente.
const CATALOG: Record<DateBasis, MetricDef[]> = {
  criacao: [
    { id: "leads", label: "Leads Criados", fmt: "num", value: (m) => m.leads, desc: "Leads criados no mês (safra por data de criação)." },
    { id: "won", label: "Vendas", fmt: "num", value: (m) => m.won, desc: "Da safra criada no mês, quantos viraram venda ganha." },
    { id: "wonRevenue", label: "Receita Ganha", fmt: "brl", value: (m) => m.wonRevenue, desc: "Soma do valor das vendas ganhas da safra." },
    { id: "ticket", label: "Ticket Médio", fmt: "brl", value: (m) => m.ticket, desc: "Receita ganha ÷ nº de vendas ganhas." },
    // Conversão por coorte: da entrada (leads criados no mês) até a venda ganha,
    // tenha o lead fechado quando tiver fechado. Meses recentes ainda amadurecem.
    { id: "convGeral", label: "Taxa de Conversão", tag: "coorte", fmt: "pct", showDirection: true,
      value: (m) => m.leads > 0 ? (m.won / m.leads) * 100 : 0,
      desc: "Vendas ganhas ÷ leads que ENTRARAM no mês (por safra de criação), independente de quando fecharam. Meses recentes ainda estão maturando: a taxa tende a subir conforme os leads em aberto fecham." },
  ],
  fechamento: [
    { id: "won", label: "Vendas Ganhas", fmt: "num", value: (m) => m.won, desc: "Negócios ganhos no mês (por data de fechamento)." },
    { id: "lost", label: "Vendas Perdidas", fmt: "num", value: (m) => m.lost, invert: true, desc: "Negócios perdidos no mês (por data de fechamento)." },
    { id: "wonRevenue", label: "Receita Ganha", fmt: "brl", value: (m) => m.wonRevenue, desc: "Soma do valor dos negócios ganhos." },
    { id: "lostRevenue", label: "Receita Perdida", fmt: "brl", value: (m) => m.lostRevenue, invert: true, desc: "Soma do valor dos negócios perdidos. Cair é bom." },
    { id: "ticket", label: "Ticket Médio", fmt: "brl", value: (m) => m.ticket, desc: "Receita ganha ÷ nº de vendas ganhas." },
    // Win rate: KPI de saúde comercial. Fica disponível como pill, mas desligado por padrão.
    { id: "taxaFechamento", label: "Taxa de Fechamento", tag: "win rate", fmt: "pct", value: (m) => m.winRate, showDirection: true,
      desc: "Vendas ganhas ÷ (ganhas + perdidas). Win rate entre os negócios que JÁ decidiram no mês — mede qualidade da negociação, não conversão do funil. Complementar à Taxa de Conversão (por coorte), não substitui." },
  ],
};

const DEFAULT_VISIBLE: Record<DateBasis, string[]> = {
  criacao: ["leads", "won", "wonRevenue", "ticket", "convGeral"],
  fechamento: ["won", "lost", "wonRevenue", "lostRevenue", "ticket"],
};

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
  const [metricOrder, setMetricOrder] = useState<string[]>([]); // ordem custom das métricas (arrastar)
  const dragMetricId = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false); // re-disparo manual das fotos
  const queryClient = useQueryClient();

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
        if (Array.isArray(v.metricOrder)) setMetricOrder(v.metricOrder);
      }
    } catch { /* visão inválida: ignora e segue com os defaults */ }
    hydrated.current = true;
  }, [viewKey]);
  useEffect(() => {
    if (!viewKey || !hydrated.current) return;
    try {
      localStorage.setItem(viewKey, JSON.stringify({
        dateBasis, rangeMonths, mode, visibleIds, chartMetric, chartMetric2, pipelineId, sellerIds, metricOrder,
      }));
    } catch { /* quota/priv mode: ignora */ }
  }, [viewKey, dateBasis, rangeMonths, mode, visibleIds, chartMetric, chartMetric2, pipelineId, sellerIds, metricOrder]);

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

  // Momento da foto atual (todas as linhas de um recompute compartilham o frozen_at).
  const lastFrozen = useMemo(() => {
    const ts = rawMonths.map((m) => m.frozenAt).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : null;
  }, [rawMonths]);

  // Re-dispara o recompute (mesma edge function do cron) e recarrega as fotos.
  // Também mostra o resultado do check de integridade que a função devolve.
  const refreshSnapshot = async () => {
    if (!wsId || refreshing) return;
    setRefreshing(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("kommo-report-snapshot", {
        body: { workspace_id: wsId, months: 12 },
      });
      if (fnErr) throw fnErr;
      await queryClient.invalidateQueries({ queryKey: ["report-snapshots"] });
      const q = (data as any)?.quality;
      if (q && q.ok === false) {
        const falhas = (q.checks || []).filter((c: any) => !c.ok).map((c: any) => c.detail || c.name).join("; ");
        toast.warning("Fotos atualizadas, mas a integridade acusou divergência", { description: falhas });
      } else {
        toast.success("Fotos atualizadas", { description: "Integridade conferida: números consistentes." });
      }
    } catch (e) {
      toast.error("Erro ao atualizar as fotos", { description: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  };

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
    const reachDefs: MetricDef[] = (latest?.metrics.reached ?? []).flatMap((r) => {
      // Contagem bruta: quantos leads da safra chegaram na etapa selecionada.
      const countDef: MetricDef = {
        id: `count:${r.id}`,
        label: r.label,
        fmt: "num",
        value: (m: ReportMetrics) => m.reached?.find((x) => x.id === r.id)?.count ?? 0,
        desc: `Nº de leads da safra que chegaram na etapa "${r.label}".`,
      };
      // Bucket "fechamento": mantém só a contagem (sem taxa própria). Demais buckets
      // também ganham a taxa "% da safra que chegou na etapa".
      if (r.id === "fechamento") return [countDef];
      const rateDef: MetricDef = {
        id: `reach:${r.id}`,
        label: `Taxa ${r.label}`,
        fmt: "pct",
        showDirection: true,
        value: (m: ReportMetrics) => {
          const item = m.reached?.find((x) => x.id === r.id);
          return m.leads > 0 && item ? (item.count / m.leads) * 100 : 0;
        },
        desc: `% da safra que chegou na etapa "${r.label}" (alcançou ÷ entrada).`,
      };
      return [countDef, rateDef];
    });
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

  // Aplica a ordem custom do usuário: primeiro as ids na ordem escolhida, depois as
  // demais do catálogo (métricas novas entram no fim). Pills e linhas seguem isto.
  const orderedCatalog = useMemo(() => {
    const byId = new Map(catalog.map((m) => [m.id, m]));
    const seen = new Set<string>();
    const out: MetricDef[] = [];
    for (const id of metricOrder) {
      const d = byId.get(id);
      if (d && !seen.has(id)) { out.push(d); seen.add(id); }
    }
    for (const m of catalog) if (!seen.has(m.id)) out.push(m);
    return out;
  }, [catalog, metricOrder]);

  const reorderMetric = (from: string, to: string) => {
    if (from === to) return;
    const ids = orderedCatalog.map((m) => m.id);
    const fi = ids.indexOf(from), ti = ids.indexOf(to);
    if (fi < 0 || ti < 0) return;
    ids.splice(ti, 0, ids.splice(fi, 1)[0]);
    setMetricOrder(ids);
  };

  const visibleMetrics = orderedCatalog.filter((m) => visibleIds.includes(m.id));
  const goalsForAxis = useMemo(() => Object.keys(goals).filter((k) => k.startsWith(`${dateBasis}:`)).length, [goals, dateBasis]);

  // A visão já é salva automaticamente; este botão dá o gesto explícito + confirmação.
  const saveView = () => {
    if (!viewKey) return;
    try {
      localStorage.setItem(viewKey, JSON.stringify({
        dateBasis, rangeMonths, mode, visibleIds, chartMetric, chartMetric2, pipelineId, sellerIds, metricOrder,
      }));
      toast.success("Visualização salva");
    } catch {
      toast.error("Não foi possível salvar a visualização");
    }
  };
  // Restaura os padrões do eixo atual (período, leitura, métricas visíveis, ordem e filtros).
  const resetView = () => {
    setRangeMonths(6);
    setMode("valores");
    setVisibleIds(DEFAULT_VISIBLE[dateBasis]);
    setMetricOrder([]);
    setChartMetric("wonRevenue");
    setChartMetric2("");
    setPipelineId("__all__");
    setSellerIds([]);
    toast.success("Visualização restaurada ao padrão");
  };

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
      <div className="print:hidden sticky top-0 -mx-6 -mt-6 mb-2 z-30 bg-card/95 backdrop-blur-sm border-b border-border">
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

      {/* Cabeçalho (tela) */}
      <div className="print:hidden flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Relatório {dateBasis === "criacao" ? "Comercial" : "Financeiro"}
            </h1>
            <p className="text-muted-foreground">
              {activeWorkspace.name} · {dateBasis === "criacao"
                ? "leads por safra de criação"
                : "resultados por fechamento"} (fotos mensais)
            </p>
            {lastFrozen && (
              <p className="text-xs text-muted-foreground/80 mt-1 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
                Dados atualizados até {format(new Date(lastFrozen), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
            )}
          </div>
          <AxisTabs value={dateBasis} onChange={onAxisChange} />
        </div>
        <div className="flex items-center gap-2 justify-end">
          {/* Ações principais visíveis; secundárias no menu, pra desafogar o topo. */}
          <Button variant="outline" size="sm" className="h-8 px-3 gap-1.5 text-xs" onClick={refreshSnapshot} disabled={refreshing || !wsId}>
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} /> {refreshing ? "Atualizando…" : "Atualizar agora"}
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-3 gap-1.5 text-xs" onClick={saveView}>
            <Save className="w-3.5 h-3.5" /> Salvar visão
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-3 gap-1.5 text-xs" onClick={() => window.print()} disabled={!hasData}>
            <Printer className="w-3.5 h-3.5" /> Exportar PDF
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Mais ações">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={resetView}>
                <RotateCcw className="w-3.5 h-3.5 mr-2" /> Restaurar padrão
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/dashboard"><LayoutDashboard className="w-3.5 h-3.5 mr-2" /> Ver dashboard (ao vivo)</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Cabeçalho (impressão): metadados do relatório — só aparece no PDF */}
      {hasData && (
        <div className="hidden print:block border-b border-border pb-3 mb-4">
          <h1 className="text-xl font-bold text-foreground">Relatório {dateBasis === "criacao" ? "Comercial" : "Financeiro"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{activeWorkspace.name}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground max-w-2xl">
            <span><strong className="text-foreground font-medium">Período:</strong> {shown.length > 0 ? `${monthLabel(shown[0].month)} – ${monthLabel(shown[shown.length - 1].month)} (${rangeMonths} meses)` : "—"}</span>
            <span><strong className="text-foreground font-medium">Funil:</strong> {pipelineId === "__all__" ? "Todos os funis" : (pipelineName.get(pipelineId) || pipelineId)}</span>
            <span><strong className="text-foreground font-medium">Vendedor:</strong> {sellerIds.length === 0 ? "Todos" : sellerIds.map((id) => sellerOptions.find((s) => s.id === id)?.name || id).join(", ")}</span>
            <span><strong className="text-foreground font-medium">Emitido em:</strong> {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
          </div>
        </div>
      )}

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
            <div className="print:hidden border-b border-border">
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
            <div className="print:hidden flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-border">
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
                <span className="text-xs font-semibold text-muted-foreground" title="Clique para mostrar/ocultar; arraste ou Alt+←/→ para reordenar">Métricas:</span>
                {orderedCatalog.map((m) => {
                  const on = visibleIds.includes(m.id);
                  return (
                    <button key={m.id} aria-pressed={on}
                      title={m.desc}
                      draggable
                      onDragStart={() => { dragMetricId.current = m.id; }}
                      onDragEnter={() => { if (dragMetricId.current) reorderMetric(dragMetricId.current, m.id); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnd={() => { dragMetricId.current = null; }}
                      onClick={() => setVisibleIds((p) => on ? p.filter((k) => k !== m.id) : [...p, m.id])}
                      onKeyDown={(e) => {
                        // Alt + ←/→ reordena via teclado (alternativa acessível ao arrastar).
                        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                        const ids = orderedCatalog.map((x) => x.id);
                        const i = ids.indexOf(m.id);
                        if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); reorderMetric(m.id, ids[i - 1]); }
                        if (e.key === "ArrowRight" && i < ids.length - 1) { e.preventDefault(); reorderMetric(m.id, ids[i + 1]); }
                      }}
                      className={cn("group flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                        on ? "bg-primary/10 border-primary/40 text-primary-ink" : "border-border/60 text-muted-foreground hover:bg-accent/50")}>
                      <GripVertical className="w-3 h-3 opacity-30 group-hover:opacity-60 -ml-0.5" />
                      {m.label}
                      {m.tag && (
                        <span className="ml-0.5 px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wide bg-accent/60 text-accent-foreground border border-border/50">
                          {m.tag}
                        </span>
                      )}
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
                          {mo.isPartial && (
                            <span className="ml-1 text-[10px] text-accent-foreground font-normal cursor-help"
                              title={dateBasis === "criacao"
                                ? "Coorte em maturação: leads deste mês ainda vão fechar — a taxa de conversão tende a subir nas próximas fotos."
                                : "Mês ainda em aberto: os números podem mudar até o fechamento."}>
                              (parcial)
                            </span>
                          )}
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
                        <td className="sticky left-0 z-10 bg-inherit font-medium px-4 py-3 whitespace-nowrap" title={met.desc}>
                          {met.desc ? <span className="cursor-help decoration-dotted underline-offset-4 hover:underline">{met.label}</span> : met.label}
                          {met.tag && (
                            <span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wide bg-accent/60 text-accent-foreground border border-border/50 align-middle">
                              {met.tag}
                            </span>
                          )}
                        </td>
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
            {dateBasis === "criacao" && (
              <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground border-t border-border/40">
                <strong className="font-medium text-foreground">Leitura por coorte:</strong> as taxas medem a safra de leads que <em>entrou</em> em cada mês, contando as vendas quando quer que tenham fechado. Meses recentes (marcados <span className="text-accent-foreground">parcial</span>) ainda estão maturando e tendem a subir — compare com segurança apenas os meses já fechados.
              </p>
            )}
          </div>

          {/* Gráfico de linha (1 ou 2 métricas, eixos independentes) */}
          <div className="dashboard-section">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="section-title mb-0">Evolução no tempo</h2>
              <span className="hidden print:inline text-xs text-muted-foreground">
                {chartDef.label}{chartDef2 ? ` vs ${chartDef2.label}` : ""}
              </span>
              <div className="print:hidden flex items-center gap-2">
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
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} className="capitalize" />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickFormatter={axisFmt(chartDef.fmt)} width={chartDef.fmt === "brl" ? 80 : 44} />
                  {chartDef2 && (
                    <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--funnel-3))", fontSize: 12 }}
                      tickFormatter={axisFmt(chartDef2.fmt)} width={chartDef2.fmt === "brl" ? 80 : 44} />
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
