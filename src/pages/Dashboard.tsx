import { useState, useMemo, useEffect } from "react";
import { subDays, startOfDay, endOfDay, differenceInDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { Link, useSearchParams } from "react-router-dom";
import { Users, TrendingUp, TrendingDown, Target, Banknote, Receipt, HandCoins, RefreshCw, SlidersHorizontal, BarChart3, Wallet, Snowflake, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AxisTabs } from "@/components/AxisTabs";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { DateBasis } from "@/lib/report-axis";
import { type SavedFilters, filtersStorageKey, parseCsvParam, parseCustomFiltersParam } from "@/lib/dashboard-filters-storage";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useKommoData, DashboardFilters } from "@/hooks/useKommoData";
import { useCoolingLeads } from "@/hooks/useCoolingLeads";
import { resolveFunnelLabel } from "@/lib/dashboard-funnel";
import { deriveDashboardMetrics, ticketAverage } from "@/lib/dashboard-metrics";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/dashboard/Header";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { FunnelVisualization } from "@/components/dashboard/FunnelVisualization";
import { SellerPerformance } from "@/components/dashboard/SellerPerformance";
import { SellerRevenue } from "@/components/dashboard/SellerRevenue";
import { TimePerStage } from "@/components/dashboard/TimePerStage";
import { OriginsCard } from "@/components/dashboard/OriginsCard";
import { groupTopN } from "@/lib/group-top-n";
import { buildPieColorMap } from "@/lib/pie-palette";
import { FunnelCycles } from "@/components/dashboard/FunnelCycles";
import { LostOpportunitiesCard } from "@/components/dashboard/LostOpportunitiesCard";
import { DataQuality } from "@/components/dashboard/DataQuality";
import { CustomFieldCharts } from "@/components/dashboard/CustomFieldCharts";
import { LossReasons } from "@/components/dashboard/LossReasons";
import { DailyLeads } from "@/components/dashboard/DailyLeads";
import { FunnelVelocity } from "@/components/dashboard/FunnelVelocity";
import { formatCustomMetricValue, getCustomMetricIcon } from "@/lib/custom-metrics";
import { FollowUpCard } from "@/components/dashboard/FollowUpCard";
import { DashboardSkeleton } from "@/components/skeletons/RouteSkeletons";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { AnimatedSection } from "@/components/dashboard/AnimatedSection";
import DashboardAiAnalysis from "@/components/dashboard/DashboardAiAnalysis";


export default function Dashboard() {
  const { activeWorkspace } = useWorkspace();
  const { permissions } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hydrated, setHydrated] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 7),
    to: subDays(new Date(), 1),
  });
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [selectedSellerIds, setSelectedSellerIds] = useState<string[]>([]);
  const [selectedUtmMediums, setSelectedUtmMediums] = useState<string[]>([]);
  const [selectedUtmCampaigns, setSelectedUtmCampaigns] = useState<string[]>([]);
  const [selectedOrigins, setSelectedOrigins] = useState<string[]>([]);
  const [selectedCustomFilters, setSelectedCustomFilters] = useState<Record<string, string[]>>({});
  const [dateBasis, setDateBasis] = useState<DateBasis>("criacao");
  const [stageLabels, setStageLabels] = useState<Record<string, string>>({});

  // Hidratar filtros salvos por workspace (ou aplicar pipeline padrão)
  useEffect(() => {
    setHydrated(false);
    if (!activeWorkspace?.id) return;
    let cancelled = false;

    (async () => {
      // 0) Funil padrão do workspace — sempre tem prioridade na abertura do dashboard.
      const { data: settings } = await supabase
        .from("dashboard_settings")
        .select("default_pipeline_ids, funnel_stage_labels")
        .eq("workspace_id", activeWorkspace.id)
        .maybeSingle();
      if (cancelled) return;
      setStageLabels((settings?.funnel_stage_labels as Record<string, string>) || {});

      // Deep link: se a URL já tem algum filtro, ela vence — inclusive sobre o funil
      // padrão do workspace, porque um link compartilhado é uma intenção explícita de
      // quem gerou o link. Não olha localStorage nesse caso.
      const urlPipelines = parseCsvParam(searchParams.get("pipelines"));
      const urlStages = parseCsvParam(searchParams.get("stages"));
      const urlSellers = parseCsvParam(searchParams.get("sellers"));
      const urlUtmMediums = parseCsvParam(searchParams.get("utmMedium"));
      const urlUtmCampaigns = parseCsvParam(searchParams.get("utmCampaign"));
      const urlOrigins = parseCsvParam(searchParams.get("origin"));
      const urlCustomFilters = parseCustomFiltersParam(searchParams.get("cf"));
      const urlAxis = searchParams.get("axis");
      const urlFrom = searchParams.get("from");
      const urlTo = searchParams.get("to");
      const hasUrlFilters = !!(urlPipelines.length || urlStages.length || urlSellers.length
        || urlUtmMediums.length || urlUtmCampaigns.length || urlOrigins.length
        || Object.keys(urlCustomFilters).length || urlAxis || urlFrom || urlTo);

      if (hasUrlFilters) {
        setDateRange(
          urlFrom
            ? { from: new Date(urlFrom), to: urlTo ? new Date(urlTo) : undefined }
            : { from: subDays(new Date(), 7), to: subDays(new Date(), 1) }
        );
        setSelectedPipelineIds(urlPipelines);
        setSelectedStageIds(urlStages);
        setSelectedSellerIds(urlSellers);
        setSelectedUtmMediums(urlUtmMediums);
        setSelectedUtmCampaigns(urlUtmCampaigns);
        setSelectedOrigins(urlOrigins);
        setSelectedCustomFilters(urlCustomFilters);
        setDateBasis(urlAxis === "fechamento" ? "fechamento" : "criacao");
        if (!cancelled) setHydrated(true);
        return;
      }

      // Funil(is) padrão do workspace — pré-selecionados na abertura (o filtro do
      // Dashboard aceita múltiplos funis, igual esse campo de Configurações).
      const defaultPipelineIds: string[] = settings?.default_pipeline_ids || [];

      // 1) Restaurar filtros salvos (período, vendedores, UTM…)
      let restoredPipelineIds: string[] = [];
      let restored = false;
      try {
        const raw = localStorage.getItem(filtersStorageKey(activeWorkspace.id));
        if (raw) {
          const saved = JSON.parse(raw) as SavedFilters;
          setDateRange(
            saved.from
              ? { from: new Date(saved.from), to: saved.to ? new Date(saved.to) : undefined }
              : { from: subDays(new Date(), 7), to: subDays(new Date(), 1) }
          );
          restoredPipelineIds = saved.pipelineIds ?? (saved.pipelineId ? [saved.pipelineId] : []);
          setSelectedStageIds(saved.stageIds ?? (saved.stageId ? [saved.stageId] : []));
          setSelectedSellerIds(saved.sellerIds ?? (saved.sellerId ? [saved.sellerId] : []));
          setSelectedUtmMediums(saved.utmMediums ?? (saved.utmMedium ? [saved.utmMedium] : []));
          setSelectedUtmCampaigns(saved.utmCampaigns ?? (saved.utmCampaign ? [saved.utmCampaign] : []));
          setSelectedOrigins(saved.origins ?? (saved.origin ? [saved.origin] : []));
          setSelectedCustomFilters(saved.customFilters ?? {});
          setDateBasis(saved.dateBasis === "fechamento" ? "fechamento" : "criacao");
          restored = true;
        }
      } catch {
        // ignora storage corrompido
      }

      if (!restored) {
        // Reset padrão
        setDateRange({ from: subDays(new Date(), 7), to: subDays(new Date(), 1) });
        setSelectedSellerIds([]);
        setSelectedUtmMediums([]);
        setSelectedUtmCampaigns([]);
        setSelectedOrigins([]);
        setSelectedCustomFilters({});
        setSelectedStageIds([]);
        setDateBasis("criacao");
      }

      // 2) Pipeline: o(s) funil(is) padrão configurado(s) vencem na abertura. Se as
      //    etapas salvas eram de outro funil, limpa (etapas são específicas de um funil).
      if (defaultPipelineIds.length) {
        setSelectedPipelineIds(defaultPipelineIds);
        const sameSelection = restoredPipelineIds.length === defaultPipelineIds.length
          && restoredPipelineIds.every((id) => defaultPipelineIds.includes(id));
        if (restored && !sameSelection) setSelectedStageIds([]);
      } else {
        setSelectedPipelineIds(restored ? restoredPipelineIds : []);
      }

      if (!cancelled) setHydrated(true);
    })();

    return () => { cancelled = true; };
    // searchParams de propósito fora das deps: só deve ler a URL na abertura/troca de
    // workspace, não a cada vez que o efeito de persistência abaixo a reescreve
    // (senão vira loop de hidratação).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id]);

  // Persistir filtros no localStorage por workspace
  useEffect(() => {
    if (!hydrated || !activeWorkspace?.id) return;
    const payload: SavedFilters = {
      from: dateRange?.from ? dateRange.from.toISOString() : undefined,
      to: dateRange?.to ? dateRange.to.toISOString() : undefined,
      pipelineIds: selectedPipelineIds,
      stageIds: selectedStageIds,
      sellerIds: selectedSellerIds,
      utmMediums: selectedUtmMediums,
      utmCampaigns: selectedUtmCampaigns,
      origins: selectedOrigins,
      customFilters: selectedCustomFilters,
      dateBasis,
    };
    try {
      localStorage.setItem(filtersStorageKey(activeWorkspace.id), JSON.stringify(payload));
    } catch {
      // ignora quota cheia
    }

    // Mantém a URL como espelho do filtro atual (deep link) — replace pra não
    // empilhar histórico de navegação a cada clique de filtro.
    const nextParams = new URLSearchParams();
    if (selectedPipelineIds.length) nextParams.set("pipelines", selectedPipelineIds.join(","));
    if (selectedStageIds.length) nextParams.set("stages", selectedStageIds.join(","));
    if (selectedSellerIds.length) nextParams.set("sellers", selectedSellerIds.join(","));
    if (selectedUtmMediums.length) nextParams.set("utmMedium", selectedUtmMediums.join(","));
    if (selectedUtmCampaigns.length) nextParams.set("utmCampaign", selectedUtmCampaigns.join(","));
    if (selectedOrigins.length) nextParams.set("origin", selectedOrigins.join(","));
    const nonEmptyCustomFilters = Object.fromEntries(Object.entries(selectedCustomFilters).filter(([, v]) => v.length));
    if (Object.keys(nonEmptyCustomFilters).length) nextParams.set("cf", JSON.stringify(nonEmptyCustomFilters));
    if (dateBasis === "fechamento") nextParams.set("axis", "fechamento");
    if (dateRange?.from) nextParams.set("from", format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) nextParams.set("to", format(dateRange.to, "yyyy-MM-dd"));
    setSearchParams(nextParams, { replace: true });
  }, [hydrated, activeWorkspace?.id, dateRange, selectedPipelineIds, selectedStageIds, selectedSellerIds, selectedUtmMediums, selectedUtmCampaigns, selectedOrigins, selectedCustomFilters, dateBasis, setSearchParams]);


  const startDate = useMemo(() => startOfDay(dateRange?.from || subDays(new Date(), 7)), [dateRange?.from]);
  const endDate = useMemo(() => endOfDay(dateRange?.to || dateRange?.from || subDays(new Date(), 1)), [dateRange?.to, dateRange?.from]);

  const filters: DashboardFilters = useMemo(() => ({
    startDate, endDate,
    pipelineIds: selectedPipelineIds,
    stageIds: selectedStageIds,
    sellerIds: selectedSellerIds,
    utmMediums: selectedUtmMediums,
    utmCampaigns: selectedUtmCampaigns,
    origins: selectedOrigins,
    customFilters: selectedCustomFilters,
    workspaceId: activeWorkspace?.id || null,
    dateBasis,
  }), [startDate, endDate, selectedPipelineIds, selectedStageIds, selectedSellerIds, selectedUtmMediums, selectedUtmCampaigns, selectedOrigins, selectedCustomFilters, activeWorkspace?.id, dateBasis]);

  const periodDays = useMemo(() => differenceInDays(endDate, startDate) + 1, [startDate, endDate]);
  const prevFilters: DashboardFilters = useMemo(() => ({
    ...filters,
    startDate: startOfDay(subDays(startDate, periodDays)),
    endDate: endOfDay(subDays(startDate, 1)),
  }), [filters, startDate, periodDays]);

  const { data, isLoading, isFetching, error, refetch, cachedAt } = useKommoData(filters);
  const { data: prevData } = useKommoData(prevFilters, { enabled: !!data });
  // Receita esfriando: mesmos filtros de funil/vendedor da tela, mas sem corte de
  // período (é uma foto do estado atual, igual à tela dedicada /leads-esfriando).
  const { data: coolingData } = useCoolingLeads(activeWorkspace?.id || null, selectedPipelineIds, selectedSellerIds, { enabled: dateBasis === "fechamento" });

  // Mapa nome→cor compartilhado entre os cards de origem (leads e vendas), para
  // que a MESMA origem apareça na MESMA cor nos dois gráficos. Usa o mesmo
  // groupTopN dos cards para que os nomes e o "Outras" batam.
  const originColorMap = useMemo(
    () => buildPieColorMap(
      groupTopN(data?.leadsOriginDistribution || [], 6),
      groupTopN(data?.wonOriginDistribution || [], 6),
    ),
    [data?.leadsOriginDistribution, data?.wonOriginDistribution],
  );

  if (!activeWorkspace) {
    return <ErrorState error="Selecione uma conta para visualizar o dashboard." onRetry={() => window.location.reload()} />;
  }
  if (isLoading && !data) return <DashboardSkeleton />;
  if (error && !data) return <ErrorState error={error} onRetry={() => refetch(true)} />;
  if (!data) return <ErrorState error="Sem dados. Clique em Atualizar agora para sincronizar com o VFlow360." onRetry={() => refetch(true)} />;

  const formatPercentage = (v: number) => `${v.toFixed(1)}%`;

  // Aba Financeira: eixo de data = fechamento (ganho + perdido). Vários cards de
  // processo/pipeline não fazem sentido nesse eixo e são ocultados (ver
  // docs/plano-abas-comercial-financeiro.md).
  const isFinance = dateBasis === "fechamento";
  const totalLeadsLabel = isFinance ? "Leads Fechados" : "Total de Leads";
  const totalLeadsTooltip = isFinance
    ? "Leads fechados no período (ganho + perdido), pela data de fechamento."
    : "Quantidade total de leads criados no período filtrado.";

  // Aplica os rótulos customizados das etapas (Configurações → Nomes das etapas do funil).
  const funnelStagesLabeled = data.funnelStages.map((s) => ({
    ...s,
    name: resolveFunnelLabel(s.id, stageLabels),
  }));

  // Tendências e métricas derivadas do período atual vs anterior — ver
  // deriveDashboardMetrics em lib/dashboard-metrics.ts.
  const {
    currentWon, prevWon, leadsTrend, wonTrend, convTrend,
    wonRevenue, negotiatingRevenue, ticketAvg, revenueTrend, negotiatingTrend, ticketTrend,
    currentWinRate, winRateTrend, lostRevenue, lostRevenueTrend,
  } = deriveDashboardMetrics(data, prevData);
  const currentLost = data.lostLeads || 0;

  // Receita em pipeline aberto e esfriando.
  const openPipelineRevenue = data.openPipelineRevenue ?? 0;
  const openPipelineCount = data.openPipelineCount ?? 0;
  const openTicketAvg = ticketAverage(openPipelineRevenue, openPipelineCount);
  const coolingRevenue = coolingData?.revenue?.total ?? 0;
  const coolingLeadsTotal = coolingData?.total ?? 0;

  return (
    <>
      {/* Barra de carregamento indeterminada: feedback ao trocar filtros/datas.
          Fica fora do container `space-y-5` de propósito — sendo `fixed`, não ocupa
          espaço no fluxo, mas o Tailwind aplica `margin-top` a qualquer irmão seguinte
          via `> * + *`, então dentro do space-y ela empurrava o Header ao aparecer/sumir. */}
      {isFetching && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 overflow-hidden bg-primary/15" role="status" aria-label="Carregando dados">
          <div className="h-full w-1/3 bg-primary animate-dashboard-loading rounded-full" />
        </div>
      )}
      <div className="space-y-5 sm:space-y-6">
      <Header
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={refetch}
        isLoading={isLoading}
        pipelines={data.pipelines}
        users={data.users}
        selectedPipelineIds={selectedPipelineIds}
        selectedStageIds={selectedStageIds}
        selectedSellerIds={selectedSellerIds}
        utmMediumValues={data.utmMediumValues || []}
        utmCampaignValues={data.utmCampaignValues || []}
        originValues={data.originValues || []}
        selectedUtmMediums={selectedUtmMediums}
        selectedUtmCampaigns={selectedUtmCampaigns}
        selectedOrigins={selectedOrigins}
        customFilterDefs={data.customFilterDefs || []}
        customFilterValues={data.customFilterValues || {}}
        selectedCustomFilters={selectedCustomFilters}
        onPipelineIdsChange={(ids) => { setSelectedPipelineIds(ids); setSelectedStageIds([]); }}
        onStageIdsChange={setSelectedStageIds}
        onSellerIdsChange={setSelectedSellerIds}
        onUtmMediumsChange={setSelectedUtmMediums}
        onUtmCampaignsChange={setSelectedUtmCampaigns}
        onOriginsChange={setSelectedOrigins}
        onCustomFilterChange={(id, values) => setSelectedCustomFilters((prev) => ({ ...prev, [id]: values }))}
        cachedAt={cachedAt}
      />

      <div className={cn("space-y-5 sm:space-y-6 transition-opacity duration-300", isFetching && "opacity-50 pointer-events-none")} aria-busy={isFetching}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Dashboard {dateBasis === "criacao" ? "Comercial" : "Financeiro"}
            </h1>
            <p className="text-muted-foreground">
              {activeWorkspace.name} · {dateBasis === "criacao"
                ? "oportunidades por data de criação"
                : "resultados por data de fechamento"}
            </p>
          </div>
          <AxisTabs value={dateBasis} onChange={setDateBasis} />
        </div>

        {/* Status + ação */}
        <div className="flex items-center gap-2 shrink-0">
          {cachedAt && !isLoading && (
            <span className="hidden md:inline text-[11px] text-muted-foreground">
              Atualizado {format(new Date(cachedAt), "HH:mm", { locale: ptBR })}
            </span>
          )}
          {permissions.viewSettings && (
            <DashboardAiAnalysis
              workspaceId={activeWorkspace.id}
              pipelines={data.pipelines}
              initialDateBasis={dateBasis}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5 text-xs"
            asChild
            title="Ver histórico congelado (comparação mês a mês)"
          >
            <Link to="/relatorios" aria-label="Ver relatórios">
              <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Relatórios</span>
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5 text-xs"
            onClick={() => refetch(true)}
            disabled={isLoading}
            title="Forçar atualização"
            aria-label="Atualizar dados do dashboard"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} aria-hidden="true" />
            <span>Atualizar</span>
          </Button>
          {permissions.viewSettings && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 gap-1.5 text-xs"
              asChild
              title="Personalizar dashboard"
            >
              <Link to="/settings/dashboard" aria-label="Personalizar dashboard">
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Personalizar</span>
              </Link>
            </Button>
          )}
        </div>
      </div>

      <AnimatedSection className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 lg:gap-5">
        <MetricCard title={totalLeadsLabel} value={data.totalLeads} icon={Users} variant="default" tooltip={totalLeadsTooltip} trend={leadsTrend} />
        <MetricCard title="Vendas Ganhas" value={currentWon} icon={Target} variant="success" tooltip="Leads que chegaram à etapa de venda ganha no período." trend={wonTrend} />
        {isFinance ? (
          <MetricCard title="Taxa de Ganho" value={formatPercentage(currentWinRate)} icon={TrendingUp} variant="accent" tooltip="Dos negócios que fecharam no período (ganhos + perdidos), o percentual que foi ganho." trend={winRateTrend} />
        ) : (
          <MetricCard title="Taxa de Conversão" value={formatPercentage(data.conversionRates.overallConversion)} icon={TrendingUp} variant="accent" tooltip="Percentual da primeira etapa até venda ganha." trend={convTrend} />
        )}
        <MetricCard title="Receita Ganha" value={formatBRL(wonRevenue)} icon={Banknote} variant="success" tooltip="Soma dos valores dos leads marcados como Venda Ganha no período." trend={revenueTrend} />
        {isFinance ? (
          <MetricCard title="Receita Perdida" value={formatBRL(lostRevenue)} icon={TrendingDown} variant="default" tooltip="Soma do valor dos leads perdidos no período (pela data de fechamento). Tendência: cair é positivo." trend={lostRevenueTrend} />
        ) : (
          <MetricCard title="Em Negociação" value={formatBRL(negotiatingRevenue)} icon={HandCoins} variant="accent" tooltip="Soma dos valores dos leads nas etapas Proposta Enviada e Fechamento — receita potencial em jogo no pipeline." trend={negotiatingTrend} />
        )}
        <MetricCard title="Ticket Médio" value={formatBRL(ticketAvg)} icon={Receipt} variant="default" tooltip="Receita ganha dividida pela quantidade de vendas ganhas no período." trend={ticketTrend} />
      </AnimatedSection>

      {isFinance ? (
        <AnimatedSection className="flex flex-col lg:flex-row gap-3 sm:gap-4 lg:gap-5 items-stretch" delay={0.05}>
          <div className="w-full lg:w-[44%] flex flex-col sm:flex-row gap-3 sm:gap-4 lg:gap-5 shrink-0">
            <div className="flex-1">
              <FunnelCycles
                cycleToWonDays={data.cycleToWonDays ?? 0}
                cycleToWonSample={data.cycleToWonSample ?? 0}
                cycleToLostDays={data.cycleToLostDays ?? 0}
                cycleToLostSample={data.cycleToLostSample ?? 0}
              />
            </div>
            <div className="flex-1">
              <LostOpportunitiesCard
                total={currentLost}
                ratePercentage={100 - currentWinRate}
                leadsDetail={data.lostLeadsDetail || []}
              />
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 lg:gap-5 auto-rows-min">
            <MetricCard title="Receita em Pipeline Aberto" value={formatBRL(openPipelineRevenue)} icon={Wallet} variant="accent" tooltip="Soma dos negócios abertos agora (não ganhos nem perdidos), sem filtro de período — foto do estado atual." />
            <MetricCard title="Ticket Médio em Aberto" value={formatBRL(openTicketAvg)} icon={Receipt} variant="accent" tooltip="Receita em pipeline aberto dividida pela quantidade de negócios abertos agora." />
            <MetricCard title="Receita Esfriando" value={formatBRL(coolingRevenue)} icon={Snowflake} variant="warning" tooltip={`Soma dos negócios abertos há 7+ dias sem atividade${coolingLeadsTotal > 0 ? ` (${coolingLeadsTotal} lead${coolingLeadsTotal === 1 ? "" : "s"})` : ""}.`} />
            {data.customMetrics && data.customMetrics.length > 0 && (
              <div className="col-span-full flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1 mt-1 border-t border-border">
                <Sparkles className="w-3 h-3 text-primary-ink" />
                Métricas Personalizadas
              </div>
            )}
            {data.customMetrics?.slice(0, 8).map((m) => (
              <MetricCard
                key={m.id}
                title={m.name}
                value={formatCustomMetricValue(m.value, m.format)}
                icon={getCustomMetricIcon(m.icon)}
                variant="accent"
                tooltip="Métrica que você criou para o seu negócio, configurável em Personalizar."
              />
            ))}
          </div>
        </AnimatedSection>
      ) : (
        <AnimatedSection className="flex flex-col lg:flex-row gap-3 sm:gap-4 lg:gap-5 items-stretch" delay={0.05}>
          <div className="flex-1">
            <FunnelVisualization
              funnelStages={funnelStagesLabeled}
              conversionRates={data.conversionRates}
              lostLeads={data.lostLeads || 0}
              lostLeadsDetail={data.lostLeadsDetail || []}
              belowLostCard={
                <FunnelCycles
                  cycleToWonDays={data.cycleToWonDays ?? 0}
                  cycleToWonSample={data.cycleToWonSample ?? 0}
                  cycleToLostDays={data.cycleToLostDays ?? 0}
                  cycleToLostSample={data.cycleToLostSample ?? 0}
                />
              }
            />
          </div>
          {data.customMetrics && data.customMetrics.length > 0 && (
            <div className="flex flex-col gap-3 sm:gap-4 lg:gap-5 w-full lg:w-72 shrink-0">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1 border-t border-border">
                <Sparkles className="w-3 h-3 text-primary-ink" />
                Métricas Personalizadas
              </div>
              {data.customMetrics.map((m) => (
                <MetricCard
                  key={m.id}
                  title={m.name}
                  value={formatCustomMetricValue(m.value, m.format)}
                  icon={getCustomMetricIcon(m.icon)}
                  variant="accent"
                  tooltip="Métrica que você criou para o seu negócio, configurável em Personalizar."
                />
              ))}
            </div>
          )}
        </AnimatedSection>
      )}

      <AnimatedSection className={cn("grid grid-cols-1 gap-5 lg:gap-6", isFinance ? "lg:grid-cols-2" : "lg:grid-cols-3")} delay={0.05}>
        {!isFinance && (
          <OriginsCard
            mode="leads"
            distribution={data.leadsOriginDistribution || []}
            fillRate={data.leadsOriginFillRate || 0}
            total={data.totalLeads}
            configured={data.utmConfigured?.source || false}
            colorMap={originColorMap}
          />
        )}
        <OriginsCard
          mode="wins"
          distribution={data.wonOriginDistribution || []}
          fillRate={data.wonOriginFillRate || 0}
          total={currentWon}
          configured={data.utmConfigured?.source || false}
          colorMap={originColorMap}
        />
        <LossReasons lossReasons={data.lossReasons || []} totalLost={data.lostLeads || 0} />
      </AnimatedSection>

      {isFinance && (
        <AnimatedSection delay={0.05}>
          <SellerRevenue sellers={data.sellers} />
        </AnimatedSection>
      )}

      {!isFinance && data.customFieldDistributions && data.customFieldDistributions.length > 0 && (
        <AnimatedSection delay={0.05}>
          <CustomFieldCharts fields={data.customFieldDistributions} />
        </AnimatedSection>
      )}

      {!isFinance && (
        <AnimatedSection delay={0.05}>
          <DataQuality customFields={data.customFields} overallFillRate={data.overallFillRate} />
        </AnimatedSection>
      )}

      {!isFinance && (
        <AnimatedSection delay={0.05}>
          <SellerPerformance
            sellers={data.sellers}
            selectedSellerIds={selectedSellerIds}
            onSellerToggle={(id) => setSelectedSellerIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id])}
            onClearSellers={() => setSelectedSellerIds([])}
          />
        </AnimatedSection>
      )}

      {!isFinance && (
        <AnimatedSection delay={0.05}>
          <FunnelVelocity velocity={data.funnelVelocity} />
        </AnimatedSection>
      )}

      {!isFinance && (
        <AnimatedSection delay={0.05}>
          <FollowUpCard data={data.followUp} />
        </AnimatedSection>
      )}

      <AnimatedSection delay={0.05}>
        <DailyLeads
          dailyLeads={data.dailyLeads || []}
          title={isFinance ? "Fechamentos por dia" : "Entrada de Oportunidades"}
          unitNoun={isFinance ? "fechamentos" : "oportunidades"}
          tooltip={isFinance
            ? "Volume diário de negócios fechados (ganho + perdido) pela data de fechamento. Verde = ganho, vermelho = perdido."
            : "Volume diário de novas oportunidades. A linha mostra a tendência ao longo do período."}
          splitWonLost={isFinance}
        />
      </AnimatedSection>

      {!isFinance && (
        <AnimatedSection delay={0.05}>
          <TimePerStage averageTimePerStage={data.averageTimePerStage} />
        </AnimatedSection>
      )}
      </div>
      </div>
    </>
  );
}
