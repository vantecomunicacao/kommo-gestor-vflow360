import { useState, useMemo, useEffect } from "react";
import { subDays, startOfDay, endOfDay, differenceInDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { Link } from "react-router-dom";
import { Users, TrendingUp, TrendingDown, Target, Banknote, Receipt, HandCoins, RefreshCw, SlidersHorizontal, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AxisTabs } from "@/components/AxisTabs";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { DateBasis } from "@/lib/report-axis";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useKommoData, DashboardFilters } from "@/hooks/useKommoData";
import { resolveFunnelLabel } from "@/lib/dashboard-funnel";
import { calcTrend, invertTrend, winRate, ticketAverage } from "@/lib/dashboard-metrics";
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
import { DataQuality } from "@/components/dashboard/DataQuality";
import { CustomFieldCharts } from "@/components/dashboard/CustomFieldCharts";
import { LossReasons } from "@/components/dashboard/LossReasons";
import { DailyLeads } from "@/components/dashboard/DailyLeads";
import { FunnelVelocity } from "@/components/dashboard/FunnelVelocity";
import { FollowUpCard } from "@/components/dashboard/FollowUpCard";
import { CoolingLeadsCard } from "@/components/dashboard/CoolingLeadsCard";
import { DashboardSkeleton } from "@/components/skeletons/RouteSkeletons";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { AnimatedSection } from "@/components/dashboard/AnimatedSection";
import DashboardAiAnalysis from "@/components/dashboard/DashboardAiAnalysis";

type SavedFilters = {
  from?: string;
  to?: string;
  pipelineId?: string | null;
  stageId?: string | null; // legado (seleção única)
  stageIds?: string[];
  sellerId?: string | null; // legado (seleção única)
  sellerIds?: string[];
  utmMedium?: string | null;
  utmCampaign?: string | null;
  dateBasis?: DateBasis;
};

const filtersStorageKey = (workspaceId: string) => `dashboard:filters:${workspaceId}`;

export default function Dashboard() {
  const { activeWorkspace } = useWorkspace();
  const { permissions } = usePermissions();
  const [hydrated, setHydrated] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 7),
    to: subDays(new Date(), 1),
  });
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [selectedSellerIds, setSelectedSellerIds] = useState<string[]>([]);
  const [selectedUtmMedium, setSelectedUtmMedium] = useState<string | null>(null);
  const [selectedUtmCampaign, setSelectedUtmCampaign] = useState<string | null>(null);
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
      // Vários funis marcados = escopo agregado (a edge function já restringe a eles);
      // aí nenhum vem pré-selecionado no filtro. Um só = abre direto nele.
      const defaultIds = settings?.default_pipeline_ids || [];
      const defaultPipeline = defaultIds.length === 1 ? defaultIds[0] : null;
      setStageLabels(((settings as any)?.funnel_stage_labels as Record<string, string>) || {});

      // 1) Restaurar filtros salvos (período, vendedores, UTM…)
      let restoredPipeline: string | null = null;
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
          restoredPipeline = saved.pipelineId ?? null;
          setSelectedStageIds(saved.stageIds ?? (saved.stageId ? [saved.stageId] : []));
          setSelectedSellerIds(saved.sellerIds ?? (saved.sellerId ? [saved.sellerId] : []));
          setSelectedUtmMedium(saved.utmMedium ?? null);
          setSelectedUtmCampaign(saved.utmCampaign ?? null);
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
        setSelectedUtmMedium(null);
        setSelectedUtmCampaign(null);
        setSelectedStageIds([]);
        setDateBasis("criacao");
      }

      // 2) Pipeline: o funil padrão configurado vence na abertura. Se as etapas salvas
      //    eram de outro funil, limpa (etapas são específicas de cada funil).
      if (defaultPipeline) {
        setSelectedPipelineId(defaultPipeline);
        if (restored && restoredPipeline !== defaultPipeline) setSelectedStageIds([]);
      } else {
        setSelectedPipelineId(restored ? restoredPipeline : null);
      }

      if (!cancelled) setHydrated(true);
    })();

    return () => { cancelled = true; };
  }, [activeWorkspace?.id]);

  // Persistir filtros no localStorage por workspace
  useEffect(() => {
    if (!hydrated || !activeWorkspace?.id) return;
    const payload: SavedFilters = {
      from: dateRange?.from ? dateRange.from.toISOString() : undefined,
      to: dateRange?.to ? dateRange.to.toISOString() : undefined,
      pipelineId: selectedPipelineId,
      stageIds: selectedStageIds,
      sellerIds: selectedSellerIds,
      utmMedium: selectedUtmMedium,
      utmCampaign: selectedUtmCampaign,
      dateBasis,
    };
    try {
      localStorage.setItem(filtersStorageKey(activeWorkspace.id), JSON.stringify(payload));
    } catch {
      // ignora quota cheia
    }
  }, [hydrated, activeWorkspace?.id, dateRange, selectedPipelineId, selectedStageIds, selectedSellerIds, selectedUtmMedium, selectedUtmCampaign, dateBasis]);


  const startDate = useMemo(() => startOfDay(dateRange?.from || subDays(new Date(), 7)), [dateRange?.from]);
  const endDate = useMemo(() => endOfDay(dateRange?.to || dateRange?.from || subDays(new Date(), 1)), [dateRange?.to, dateRange?.from]);

  const filters: DashboardFilters = useMemo(() => ({
    startDate, endDate,
    pipelineId: selectedPipelineId,
    stageIds: selectedStageIds,
    sellerIds: selectedSellerIds,
    utmMedium: selectedUtmMedium,
    utmCampaign: selectedUtmCampaign,
    workspaceId: activeWorkspace?.id || null,
    dateBasis,
  }), [startDate, endDate, selectedPipelineId, selectedStageIds, selectedSellerIds, selectedUtmMedium, selectedUtmCampaign, activeWorkspace?.id, dateBasis]);

  const periodDays = useMemo(() => differenceInDays(endDate, startDate) + 1, [startDate, endDate]);
  const prevFilters: DashboardFilters = useMemo(() => ({
    ...filters,
    startDate: startOfDay(subDays(startDate, periodDays)),
    endDate: endOfDay(subDays(startDate, 1)),
  }), [filters, startDate, periodDays]);

  const { data, isLoading, isFetching, error, refetch, cachedAt } = useKommoData(filters);
  const { data: prevData } = useKommoData(prevFilters, { enabled: !!data });

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

  const currentWon = data.funnelStages.find((s) => s.id === "venda_ganha")?.count || 0;
  const prevWon = prevData?.funnelStages.find((s) => s.id === "venda_ganha")?.count || 0;

  const leadsTrend = prevData ? calcTrend(data.totalLeads, prevData.totalLeads) : undefined;
  const wonTrend = prevData ? calcTrend(currentWon, prevWon) : undefined;
  const convTrend = prevData ? calcTrend(data.conversionRates.overallConversion, prevData.conversionRates.overallConversion) : undefined;

  const wonRevenue = data.wonMonetary ?? 0;
  const negotiatingRevenue = data.negotiatingMonetary ?? 0;
  const ticketAvg = ticketAverage(wonRevenue, currentWon);
  const prevWonRevenue = prevData?.wonMonetary ?? 0;
  const prevNegotiatingRevenue = prevData?.negotiatingMonetary ?? 0;
  const prevTicketAvg = ticketAverage(prevWonRevenue, prevWon);
  const revenueTrend = prevData ? calcTrend(wonRevenue, prevWonRevenue) : undefined;
  const negotiatingTrend = prevData ? calcTrend(negotiatingRevenue, prevNegotiatingRevenue) : undefined;
  const ticketTrend = prevData ? calcTrend(ticketAvg, prevTicketAvg) : undefined;

  // Financeiro: taxa de ganho (win rate) entre os que fecharam, e receita perdida.
  const currentWinRate = winRate(currentWon, data.lostLeads || 0);
  const prevWinRate = winRate(prevWon, prevData?.lostLeads || 0);
  const winRateTrend = prevData ? calcTrend(currentWinRate, prevWinRate) : undefined;
  const lostRevenue = data.lostMonetary ?? 0;
  const prevLostRevenue = prevData?.lostMonetary ?? 0;
  // Perder MENOS dinheiro é positivo → invertemos o sinal da tendência.
  const lostRevenueTrend = invertTrend(prevData ? calcTrend(lostRevenue, prevLostRevenue) : undefined);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Barra de carregamento indeterminada: feedback ao trocar filtros/datas */}
      {isFetching && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 overflow-hidden bg-primary/15" role="status" aria-label="Carregando dados">
          <div className="h-full w-1/3 bg-primary animate-dashboard-loading rounded-full" />
        </div>
      )}
      <Header
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={refetch}
        isLoading={isLoading}
        pipelines={data.pipelines}
        users={data.users}
        selectedPipelineId={selectedPipelineId}
        selectedStageIds={selectedStageIds}
        selectedSellerIds={selectedSellerIds}
        utmMediumValues={data.utmMediumValues || []}
        utmCampaignValues={data.utmCampaignValues || []}
        selectedUtmMedium={selectedUtmMedium}
        selectedUtmCampaign={selectedUtmCampaign}
        onPipelineChange={(id) => { setSelectedPipelineId(id); setSelectedStageIds([]); }}
        onStageIdsChange={setSelectedStageIds}
        onSellerIdsChange={setSelectedSellerIds}
        onUtmMediumChange={setSelectedUtmMedium}
        onUtmCampaignChange={setSelectedUtmCampaign}
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
        <AnimatedSection delay={0.05}>
          <FunnelCycles
            cycleToWonDays={data.cycleToWonDays ?? 0}
            cycleToWonSample={data.cycleToWonSample ?? 0}
            cycleToLostDays={data.cycleToLostDays ?? 0}
            cycleToLostSample={data.cycleToLostSample ?? 0}
          />
        </AnimatedSection>
      ) : (
        <AnimatedSection delay={0.05}>
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
          <CoolingLeadsCard data={data.coolingLeads} />
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
            ? "Volume diário de negócios fechados (ganho + perdido) pela data de fechamento. A linha mostra a tendência."
            : "Volume diário de novas oportunidades. A linha mostra a tendência ao longo do período."}
        />
      </AnimatedSection>

      {!isFinance && (
        <AnimatedSection delay={0.05}>
          <TimePerStage averageTimePerStage={data.averageTimePerStage} />
        </AnimatedSection>
      )}
      </div>
    </div>
  );
}
