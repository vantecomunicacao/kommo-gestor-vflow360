import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { LayoutDashboard, GitBranch, Users, Target, ChevronDown, Printer, GripVertical, Save, RotateCcw, MoreHorizontal, RefreshCw, CalendarRange, Lock, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { CATALOG, DEFAULT_VISIBLE, fmtValue, monthLabel, trendClass, pctChange, aggregateBySellers, buildReachCatalog, buildCustomRateCatalog, resolveComparisonValue, REPORT_SNAPSHOT_MONTHS, type MetricDef, type Fmt, type CompareMode } from "@/lib/reports-metrics";
import { Sparkline } from "@/components/reports/Sparkline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FilterSelect } from "@/components/filters/FilterSelect";
import { MultiFilterSelect } from "@/components/filters/MultiFilterSelect";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AxisTabs } from "@/components/AxisTabs";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useReportSnapshots, DateBasis, ReportMonth, ReportMetrics } from "@/hooks/useReportSnapshots";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

// Opções do seletor "Comparar com" — cada uma diz explicitamente o que calcula,
// pra não deixar o usuário assumir "mês anterior" quando na verdade é outra base.
const COMPARE_OPTIONS: { value: CompareMode; label: string; desc: string }[] = [
  { value: "previous", label: "Mês anterior", desc: "Cada mês contra o imediatamente anterior. Sensível a ruído em baixo volume." },
  { value: "yoy", label: "Mesmo mês, ano passado", desc: "Controla sazonalidade — compara com o mesmo mês do ano anterior (YoY)." },
  { value: "movavg3", label: "Média móvel (3 meses)", desc: "Suaviza oscilações — compara contra a média dos 3 meses anteriores." },
  { value: "none", label: "Sem comparação", desc: "Mostra só os valores do período, sem seta de tendência." },
];

export default function Reports() {
  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?.id || null;
  const [dateBasis, setDateBasis] = useState<DateBasis>("fechamento");
  const [rangeMonths, setRangeMonths] = useState<number>(6);
  // Período customizado (granularidade de MÊS, não de dia — a foto é mensal).
  // periodMode "preset" usa rangeMonths (últimos N); "custom" usa customFrom/To.
  const [periodMode, setPeriodMode] = useState<"preset" | "custom">("preset");
  const [customFrom, setCustomFrom] = useState<string>(""); // mês ISO "YYYY-MM-01"
  const [customTo, setCustomTo] = useState<string>("");
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");
  const [mode, setMode] = useState<"valores" | "variacao">("valores");
  const [visibleIds, setVisibleIds] = useState<string[]>(DEFAULT_VISIBLE.fechamento);
  const [chartMetric, setChartMetric] = useState<string>("wonRevenue");
  const [chartMetric2, setChartMetric2] = useState<string>(""); // 2ª métrica (eixo direito), opcional
  // null = todos os funis (mesmo sentinel que o Dashboard usa). "__all__" só existe
  // como valor gravado em `report_snapshots.pipeline_id` (contrato do useReportSnapshots).
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [sellerIds, setSellerIds] = useState<string[]>([]); // vazio = todos os vendedores
  const [hoveredCol, setHoveredCol] = useState<number | null>(null); // coluna (mês) em foco
  const [metricOrder, setMetricOrder] = useState<string[]>([]); // ordem custom das métricas (arrastar)
  const dragMetricId = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false); // re-disparo manual das fotos
  const queryClient = useQueryClient();

  // Liga automaticamente as taxas de etapa recém-configuradas (só na 1ª vez que
  // aparecem) — declarado aqui (antes da persistência) porque o payload salvo
  // inclui `seenReachIds`, lido deste ref no momento em que é montado.
  const seenReach = useRef<Set<string>>(new Set());

  // Persistência da visão (localStorage, por workspace): lembra a última configuração
  // sem botão. Hidrata ao trocar de conta e regrava a cada mudança relevante.
  const viewKey = wsId ? `kommo-report-view:${wsId}` : null;
  const hydrated = useRef(false);
  const buildViewPayload = () => ({
    dateBasis, rangeMonths, mode, visibleIds, chartMetric, chartMetric2, pipelineId, sellerIds, metricOrder,
    seenReachIds: [...seenReach.current],
    periodMode, customFrom, customTo, compareMode,
  });
  useEffect(() => {
    hydrated.current = false;
    seenReach.current = new Set();
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
        // Compatível com visões salvas antigas ("__all__" = nenhum funil selecionado).
        if (typeof v.pipelineId === "string") setPipelineId(v.pipelineId === "__all__" ? null : v.pipelineId);
        if (Array.isArray(v.sellerIds)) setSellerIds(v.sellerIds);
        if (Array.isArray(v.metricOrder)) setMetricOrder(v.metricOrder);
        // Métricas de taxa já vistas (evita reativar de novo o que o usuário desligou).
        if (Array.isArray(v.seenReachIds)) seenReach.current = new Set(v.seenReachIds);
        // Período customizado e comparação — views salvas antes desta feature não
        // têm esses campos, então os defaults (preset + "previous") se aplicam.
        if (v.periodMode === "preset" || v.periodMode === "custom") setPeriodMode(v.periodMode);
        if (typeof v.customFrom === "string") setCustomFrom(v.customFrom);
        if (typeof v.customTo === "string") setCustomTo(v.customTo);
        if (["previous", "yoy", "movavg3", "none"].includes(v.compareMode)) setCompareMode(v.compareMode);
      }
    } catch { /* visão inválida: ignora e segue com os defaults */ }
    hydrated.current = true;
  }, [viewKey]);
  useEffect(() => {
    if (!viewKey || !hydrated.current) return;
    try {
      localStorage.setItem(viewKey, JSON.stringify(buildViewPayload()));
    } catch { /* quota/priv mode: ignora */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, dateBasis, rangeMonths, mode, visibleIds, chartMetric, chartMetric2, pipelineId, sellerIds, metricOrder, periodMode, customFrom, customTo, compareMode]);

  // "Variação" não existe sem uma base de comparação — se o usuário desligar a
  // comparação enquanto está nessa leitura, volta pra "Valores" (senão ficaria
  // preso numa leitura cujo botão de sair sumiu do toggle "Leitura").
  useEffect(() => {
    if (compareMode === "none" && mode === "variacao") setMode("valores");
  }, [compareMode, mode]);

  // Nomes de funil e vendedor (para os seletores) — buscados ao vivo, fora da foto.
  const { data: pipelines = [] } = useQuery({
    queryKey: ["report-pipelines", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      // Só funis vivos no seletor (arquivado/apagado no Kommo fica de fora).
      const { data } = await supabase.from("pipelines").select("kommo_id,name")
        .eq("workspace_id", wsId!).eq("is_archive", false).eq("is_deleted", false)
        .order("sort", { nullsFirst: false });
      return (data || []) as { kommo_id: string; name: string }[];
    },
  });
  // "Funis do Dashboard" (Configurações) restringe quais funis aparecem pra
  // escolher aqui — nenhum marcado lá = mostra todos, igual sempre.
  const { data: defaultPipelineIds = [] } = useQuery({
    queryKey: ["report-default-pipelines", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await supabase.from("dashboard_settings").select("default_pipeline_ids")
        .eq("workspace_id", wsId!).maybeSingle();
      return (data?.default_pipeline_ids || []) as string[];
    },
  });
  const visiblePipelines = useMemo(
    () => (defaultPipelineIds.length ? pipelines.filter((p) => defaultPipelineIds.includes(p.kommo_id)) : pipelines),
    [pipelines, defaultPipelineIds],
  );
  // Reconcilia seleção persistida que aponte pra um funil que deixou de ser
  // "comercial" nas Configurações.
  useEffect(() => {
    if (defaultPipelineIds.length && pipelineId && !defaultPipelineIds.includes(pipelineId)) {
      setPipelineId(null);
    }
  }, [defaultPipelineIds, pipelineId]);
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
      const raw = data?.report_goals;
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
        .upsert({ workspace_id: wsId, report_goals: next }, { onConflict: "workspace_id" });
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

  const { months: rawMonths, isLoading, error, refetch } = useReportSnapshots(wsId, dateBasis, pipelineId ?? "__all__");
  useEffect(() => {
    if (error) console.error("Reports: falha ao carregar report_snapshots:", error);
  }, [error]);

  // Momento da foto atual (todas as linhas de um recompute compartilham o frozen_at).
  const lastFrozen = useMemo(() => {
    const ts = rawMonths.map((m) => m.frozenAt).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : null;
  }, [rawMonths]);
  // Cron roda 1x/dia; > 36h sem atualizar sugere falha silenciosa (sem retry/alerta
  // do lado do cron) — avisa na tela em vez de deixar o usuário confiar num dado velho.
  const isStale = useMemo(
    () => (lastFrozen ? differenceInHours(new Date(), new Date(lastFrozen)) > 36 : false),
    [lastFrozen],
  );

  // Re-dispara o recompute (mesma edge function do cron) e recarrega as fotos.
  // Também mostra o resultado do check de integridade que a função devolve.
  const refreshSnapshot = async () => {
    if (!wsId || refreshing) return;
    setRefreshing(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("kommo-report-snapshot", {
        body: { workspace_id: wsId, months: REPORT_SNAPSHOT_MONTHS },
      });
      if (fnErr) throw fnErr;
      await queryClient.invalidateQueries({ queryKey: ["report-snapshots"] });
      type QualityCheck = { name: string; ok: boolean; detail?: string };
      const q = (data as { quality?: { ok: boolean; checks: QualityCheck[] } } | null)?.quality;
      if (q && q.ok === false) {
        const falhas = (q.checks || []).filter((c) => !c.ok).map((c) => c.detail || c.name).join("; ");
        toast.warning("Fotos atualizadas, mas a integridade acusou divergência", { description: falhas });
      } else {
        toast.success("Fotos atualizadas", {
          description: q ? "Integridade conferida: números consistentes." : undefined,
        });
      }
    } catch (e) {
      toast.error("Erro ao atualizar as fotos", { description: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  };

  // "Forçar recálculo" — ação separada e deliberada (menu ⋯, não o "Atualizar
  // agora" comum): ignora a trava só pro intervalo de meses escolhido, pra
  // corrigir configuração errada (ex. mapeamento de funil, Métricas Personalizadas)
  // em meses já travados. O "Atualizar agora" continua sempre respeitando a trava.
  const [forceDialogOpen, setForceDialogOpen] = useState(false);
  const [forceFromMonth, setForceFromMonth] = useState("");
  const [forceToMonth, setForceToMonth] = useState("");
  const [forcing, setForcing] = useState(false);
  const openForceDialog = () => {
    setForceFromMonth(months[0]?.month || "");
    setForceToMonth(months[months.length - 1]?.month || "");
    setForceDialogOpen(true);
  };
  const forceRecompute = async () => {
    if (!wsId || !forceFromMonth || !forceToMonth) return;
    if (!window.confirm(
      `Recalcular mesmo os meses já travados, de ${monthLabel(forceFromMonth)} até ${monthLabel(forceToMonth)}? ` +
      "Use só pra corrigir configuração errada (ex. mapeamento de funil) — o número volta a travar depois.",
    )) return;
    setForcing(true);
    try {
      const { error: fnErr } = await supabase.functions.invoke("kommo-report-snapshot", {
        body: { workspace_id: wsId, months: REPORT_SNAPSHOT_MONTHS, force: true, forceFrom: forceFromMonth, forceTo: forceToMonth },
      });
      if (fnErr) throw fnErr;
      await queryClient.invalidateQueries({ queryKey: ["report-snapshots"] });
      toast.success("Recálculo forçado concluído", { description: "Os meses no intervalo escolhido foram recalculados e travam de novo a partir de agora." });
      setForceDialogOpen(false);
    } catch (e) {
      toast.error("Erro ao forçar recálculo", { description: (e as Error).message });
    } finally {
      setForcing(false);
    }
  };

  // Aplica os vendedores selecionados (soma os sub-blocos bySeller escolhidos, mês a
  // mês) — ver aggregateBySellers em lib/reports-metrics.ts.
  const months: ReportMonth[] = useMemo(
    () => aggregateBySellers(rawMonths, sellerIds),
    [rawMonths, sellerIds],
  );

  // Vendedores disponíveis (união dos sub-blocos ao longo dos meses).
  const sellerOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const mo of rawMonths) for (const id of Object.keys(mo.metrics.bySeller ?? {})) ids.add(id);
    return [...ids]
      .map((id) => ({ id, name: id === "__none__" ? "Não atribuído" : (userName.get(id) || `Usuário ${id.slice(0, 6)}`) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rawMonths, userName]);

  // Catálogo = métricas do eixo + (na aba Comercial) taxas de etapa legadas
  // (meses antigos já travados, ver buildReachCatalog) + Métricas Personalizadas
  // visíveis no Relatório (buildCustomRateCatalog) — lib/reports-metrics.ts.
  const catalog = useMemo<MetricDef[]>(
    () => [...buildReachCatalog(dateBasis, months), ...buildCustomRateCatalog(dateBasis, months)],
    [dateBasis, months],
  );

  const onAxisChange = (v: string) => {
    const axis = v as DateBasis;
    setDateBasis(axis);
    setVisibleIds(DEFAULT_VISIBLE[axis]);
    seenReach.current.clear();
    if (!CATALOG[axis].some((m) => m.id === chartMetric)) setChartMetric(CATALOG[axis][0].id);
    if (chartMetric2 && !CATALOG[axis].some((m) => m.id === chartMetric2)) setChartMetric2("");
  };

  // Liga automaticamente as taxas/métricas dinâmicas recém-configuradas (só na
  // 1ª vez que aparecem — inclui taxas de etapa legadas E Métricas Personalizadas
  // novas) — `seenReach` é declarado acima, junto da persistência da visão.
  const reachIds = useMemo(
    () => catalog.filter((m) => m.id.startsWith("reach:") || m.id.startsWith("custom:")).map((m) => m.id),
    [catalog],
  );
  useEffect(() => {
    const fresh = reachIds.filter((id) => !seenReach.current.has(id));
    if (fresh.length) {
      fresh.forEach((id) => seenReach.current.add(id));
      setVisibleIds((prev) => [...prev, ...fresh.filter((id) => !prev.includes(id))]);
    }
  }, [reachIds]);

  const shown: ReportMonth[] = useMemo(() => {
    if (periodMode === "custom" && customFrom && customTo) {
      return months.filter((m) => m.month >= customFrom && m.month <= customTo);
    }
    return months.slice(-rangeMonths);
  }, [months, rangeMonths, periodMode, customFrom, customTo]);

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
      localStorage.setItem(viewKey, JSON.stringify(buildViewPayload()));
      toast.success("Visualização salva");
    } catch {
      toast.error("Não foi possível salvar a visualização");
    }
  };
  // Restaura os padrões do eixo atual (período, leitura, métricas visíveis, ordem e filtros).
  const resetView = () => {
    setRangeMonths(6);
    setPeriodMode("preset");
    setCustomFrom("");
    setCustomTo("");
    setCompareMode("previous");
    setMode("valores");
    setVisibleIds(DEFAULT_VISIBLE[dateBasis]);
    setMetricOrder([]);
    setChartMetric("wonRevenue");
    setChartMetric2("");
    setPipelineId(null);
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

  // Marca o último ponto com um contorno vazado/tracejado quando o mês é parcial —
  // evita que uma queda no ponto mais recente seja lida como tendência fechada.
  const lastIsPartial = shown.length > 0 && shown[shown.length - 1].isPartial;
  const partialAwareDot = (color: string) => (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g key={`dot-${index}`} />;
    const isLastPartial = lastIsPartial && index === chartData.length - 1;
    return (
      <circle key={`dot-${index}`} cx={cx} cy={cy} r={isLastPartial ? 4 : 3}
        fill={isLastPartial ? "hsl(var(--card))" : color} stroke={color}
        strokeWidth={isLastPartial ? 2 : 0} strokeDasharray={isLastPartial ? "2 2" : undefined} />
    );
  };

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
                <button key={n} onClick={() => { setPeriodMode("preset"); setRangeMonths(n); }}
                  className={cn("px-2.5 h-8 rounded-md text-xs font-semibold border transition-colors",
                    periodMode === "preset" && rangeMonths === n ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:bg-accent/50")}>
                  {n}m
                </button>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={cn("flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-semibold border transition-colors",
                      periodMode === "custom" ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:bg-accent/50")}>
                    <CalendarRange className="w-3.5 h-3.5" />
                    {periodMode === "custom" && customFrom && customTo
                      ? `${monthLabel(customFrom)} – ${monthLabel(customTo)}`
                      : "Personalizado"}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Foto mensal congelada — escolha o mês inicial e final, não um intervalo de dias.
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80">De</label>
                      <select
                        className="h-8 text-xs font-semibold rounded-md border border-border/60 bg-background px-2"
                        value={customFrom || months[0]?.month || ""}
                        onChange={(e) => setCustomFrom(e.target.value)}>
                        {months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
                      </select>
                    </div>
                    <span className="text-muted-foreground text-xs pb-2">→</span>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80">Até</label>
                      <select
                        className="h-8 text-xs font-semibold rounded-md border border-border/60 bg-background px-2"
                        value={customTo || months[months.length - 1]?.month || ""}
                        onChange={(e) => setCustomTo(e.target.value)}>
                        {months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
                      </select>
                    </div>
                    <Button size="sm" className="h-8 text-xs" disabled={months.length === 0}
                      onClick={() => {
                        setCustomFrom((f) => f || months[0]?.month || "");
                        setCustomTo((t) => t || months[months.length - 1]?.month || "");
                        setPeriodMode("custom");
                      }}>
                      Aplicar
                    </Button>
                  </div>
                  {months.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-3">
                      Dados disponíveis desde <strong className="text-foreground font-medium">{monthLabel(months[0].month)}</strong>.
                    </p>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <Separator orientation="vertical" className="h-10 hidden md:block self-end mb-1" />

          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">Comparar com</span>
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-semibold border border-border/60 text-muted-foreground hover:bg-accent/50 transition-colors min-w-[168px] justify-between">
                  {COMPARE_OPTIONS.find((o) => o.value === compareMode)?.label}
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-1.5">
                {COMPARE_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => setCompareMode(opt.value)}
                    className={cn("w-full text-left px-2.5 py-2 rounded-md transition-colors",
                      compareMode === opt.value ? "bg-accent/60" : "hover:bg-accent/40")}>
                    <div className={cn("text-xs font-semibold", compareMode === opt.value ? "text-primary-ink" : "text-foreground")}>
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.desc}</div>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>

          <Separator orientation="vertical" className="h-10 hidden md:block self-end mb-1" />

          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">Funil de vendas</span>
            <FilterSelect
              value={pipelineId}
              onChange={setPipelineId}
              placeholder="Funil"
              icon={GitBranch}
              options={visiblePipelines.map((p) => ({ id: p.kommo_id, name: p.name }))}
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
              <p className={cn("text-xs mt-1 flex items-center gap-1.5", isStale ? "text-accent-foreground" : "text-muted-foreground/80")}>
                <span className={cn("inline-block w-1.5 h-1.5 rounded-full", isStale ? "bg-accent-foreground" : "bg-success")} />
                {isStale ? "Dados desatualizados — última foto de" : "Dados atualizados até"} {format(new Date(lastFrozen), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                {isStale && " · clique em “Atualizar agora”"}
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
              <DropdownMenuItem onClick={openForceDialog} disabled={!wsId}>
                <ShieldOff className="w-3.5 h-3.5 mr-2" /> Forçar recálculo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={forceDialogOpen} onOpenChange={setForceDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Forçar recálculo</DialogTitle>
            <DialogDescription>
              Recalcula os meses escolhidos mesmo que já estejam travados — use só pra
              corrigir configuração errada (ex. mapeamento de funil, Métricas Personalizadas).
              Depois de recalculados, os meses voltam a travar normalmente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-end gap-2 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80">De</label>
              <select
                className="h-8 text-xs font-semibold rounded-md border border-border/60 bg-background px-2"
                value={forceFromMonth}
                onChange={(e) => setForceFromMonth(e.target.value)}>
                {months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
              </select>
            </div>
            <span className="text-muted-foreground text-xs pb-2">→</span>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80">Até</label>
              <select
                className="h-8 text-xs font-semibold rounded-md border border-border/60 bg-background px-2"
                value={forceToMonth}
                onChange={(e) => setForceToMonth(e.target.value)}>
                {months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setForceDialogOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={forceRecompute} disabled={forcing || !forceFromMonth || !forceToMonth}>
              {forcing ? "Recalculando…" : "Recalcular mesmo travado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cabeçalho (impressão): metadados do relatório — só aparece no PDF */}
      {hasData && (
        <div className="hidden print:block border-b border-border pb-3 mb-4">
          <h1 className="text-xl font-bold text-foreground">Relatório {dateBasis === "criacao" ? "Comercial" : "Financeiro"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{activeWorkspace.name}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground max-w-2xl">
            <span><strong className="text-foreground font-medium">Período:</strong> {shown.length > 0 ? `${monthLabel(shown[0].month)} – ${monthLabel(shown[shown.length - 1].month)} (${shown.length} ${shown.length === 1 ? "mês" : "meses"})` : "—"}</span>
            <span><strong className="text-foreground font-medium">Comparar com:</strong> {COMPARE_OPTIONS.find((o) => o.value === compareMode)?.label}</span>
            <span><strong className="text-foreground font-medium">Funil:</strong> {pipelineId ? (pipelineName.get(pipelineId) || pipelineId) : "Todos os funis"}</span>
            <span><strong className="text-foreground font-medium">Vendedor:</strong> {sellerIds.length === 0 ? "Todos" : sellerIds.map((id) => sellerOptions.find((s) => s.id === id)?.name || id).join(", ")}</span>
            <span><strong className="text-foreground font-medium">Emitido em:</strong> {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
          </div>
        </div>
      )}

      {isLoading && <div className="dashboard-section text-muted-foreground">Carregando fotos…</div>}
      {error && (
        <ErrorState
          error="Não foi possível carregar os relatórios. Tente novamente em instantes."
          onRetry={() => { refetch(); }}
        />
      )}

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
                {(compareMode === "none" ? (["valores"] as const) : (["valores", "variacao"] as const)).map((m) => (
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
                <caption className="sr-only">
                  Comparativo mensal de métricas do relatório {dateBasis === "criacao" ? "comercial" : "financeiro"}, por métrica e mês.
                </caption>
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th scope="col" className="sticky left-0 z-10 bg-inherit text-left font-semibold text-muted-foreground px-4 py-3 min-w-[160px]">Métrica</th>
                    {shown.map((mo, i) => {
                      const isLast = i === shown.length - 1;
                      return (
                        <th key={mo.month} scope="col"
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
                          {mo.locked && (
                            <Lock className="inline-block w-2.5 h-2.5 ml-1 mb-0.5 text-muted-foreground cursor-help"
                              aria-label="Travado"
                              title="Travado — número final, não muda mais (mesmo que um lead reabra depois)." />
                          )}
                        </th>
                      );
                    })}
                    <th scope="col" className="text-right font-semibold text-muted-foreground px-4 py-3 border-l border-border/40">Tendência</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMetrics.map((met, rowIdx) => {
                    const series = shown.map((mo) => met.value(mo.metrics));
                    return (
                      <tr key={met.id}
                        className={cn("border-b border-border/60 last:border-0 transition-colors hover:bg-accent",
                          rowIdx % 2 === 1 ? "bg-muted" : "bg-card")}>
                        <th scope="row" className="sticky left-0 z-10 bg-inherit text-left font-medium px-4 py-3 whitespace-nowrap" title={met.desc}>
                          {met.desc ? <span className="cursor-help decoration-dotted underline-offset-4 hover:underline">{met.label}</span> : met.label}
                          {met.tag && (
                            <span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wide bg-accent/60 text-accent-foreground border border-border/50 align-middle">
                              {met.tag}
                            </span>
                          )}
                        </th>
                        {shown.map((mo, i) => {
                          const v = met.value(mo.metrics);
                          // Busca por mês-calendário na série completa (não pelo índice de `shown`)
                          // — ver resolveComparisonValue em lib/reports-metrics.ts.
                          const prev = compareMode === "none" ? null : resolveComparisonValue(months, mo.month, compareMode, met.value);
                          const noBase = compareMode !== "none" && prev === null;
                          const variacao = mode === "variacao" && prev !== null;
                          const isLast = i === shown.length - 1;
                          return (
                            <td key={mo.month}
                              onMouseEnter={() => setHoveredCol(i)}
                              className={cn("text-right px-4 py-3 whitespace-nowrap tabular-nums border-l border-border/40 transition-colors",
                                hoveredCol === i ? "bg-primary/10" : isLast ? "bg-primary/5" : "",
                                variacao ? trendClass(v, prev!, met.invert) : "text-foreground")}>
                              {mode === "variacao" && noBase ? (
                                <span className="text-[11px] italic text-muted-foreground">sem base</span>
                              ) : variacao ? pctChange(v, prev!) : fmtValue(v, met.fmt)}
                              {!variacao && met.showDirection && prev !== null && v !== prev && (
                                <span className={cn("ml-1 text-[10px]", trendClass(v, prev, met.invert))}>{v > prev ? "▲" : "▼"}</span>
                              )}
                              {mode === "valores" && met.showDirection && noBase && (
                                <span className="ml-1 text-[10px] italic text-muted-foreground">s/ base</span>
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
                <strong className="font-medium text-foreground">Coorte:</strong> toda esta aba soma a safra de leads que <em>entrou</em> em cada mês, contando venda quando quer que tenha fechado — até travar (<Lock className="inline-block w-2.5 h-2.5 mx-0.5 mb-0.5" />, definitivo ~60 dias após o mês fechar). Meses <span className="text-accent-foreground">parcial</span> ainda maturam; compare com segurança só os já travados.
              </p>
            )}
            {dateBasis === "criacao" && !catalog.some((m) => m.id.startsWith("reach:") || m.id.startsWith("count:") || m.id.startsWith("custom:")) && (
              <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground border-t border-border/40">
                <strong className="font-medium text-foreground">Sem métricas de etapa.</strong> Configure em Configurações → Dashboard → aba "Métricas &amp; Relatório".
              </p>
            )}
            {dateBasis === "fechamento" && (
              <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground border-t border-border/40">
                <strong className="font-medium text-foreground">Foto do mês:</strong> trava (<Lock className="inline-block w-2.5 h-2.5 mx-0.5 mb-0.5" />) ~3 dias após fechar. Antes disso, reaberturas ainda podem mudar o número; depois, não muda mais.
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
                    dot={partialAwareDot("hsl(var(--primary))")} activeDot={{ r: 5 }} />
                  {chartDef2 && (
                    <Line yAxisId="right" type="monotone" dataKey="v2" name="v2" stroke="hsl(var(--funnel-3))" strokeWidth={2.5}
                      dot={partialAwareDot("hsl(var(--funnel-3))")} activeDot={{ r: 5 }} />
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
