import { useState } from "react";
import { FunnelStage, ConversionRates, StageLead } from "@/hooks/useKommoData";
import { TrendingUp, ArrowDown } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";
import { LeadListDialog } from "./LeadListDialog";
import { LostOpportunitiesCard } from "./LostOpportunitiesCard";

interface FunnelVisualizationProps {
  funnelStages: FunnelStage[];
  conversionRates: ConversionRates;
  lostLeads: number;
  lostLeadsDetail?: StageLead[];
  /** Conteúdo renderizado abaixo do card "Oportunidades Perdidas" na coluna direita. */
  belowLostCard?: React.ReactNode;
}

const formatPercentage = (v: number) => `${v.toFixed(1)}%`;

const stageAccents = [
  { bg: "bg-funnel-1", border: "border-funnel-1/40", icon: "text-funnel-1-ink" },
  { bg: "bg-funnel-2", border: "border-funnel-2/40", icon: "text-funnel-2-ink" },
  { bg: "bg-funnel-3", border: "border-funnel-3/40", icon: "text-funnel-3-ink" },
  { bg: "bg-funnel-4", border: "border-funnel-4/40", icon: "text-funnel-4-ink" },
];
// Venda Ganha se destaca em verde (independente da posição na cascata) — as demais
// etapas seguem a escala azul de stageAccents.
const wonAccent = { bg: "bg-success", border: "border-success/40", icon: "text-success-foreground" };

export function FunnelVisualization({ funnelStages, conversionRates, lostLeads, lostLeadsDetail = [], belowLostCard }: FunnelVisualizationProps) {
  const [selectedStage, setSelectedStage] = useState<{ title: string; leads: StageLead[] } | null>(null);

  const conversionLabels = [
    conversionRates.contatoToProsposta,
    conversionRates.propostaToFechamento,
    conversionRates.fechamentoToVenda,
  ];

  const topPassage = funnelStages[0]?.count ?? 0;
  // Total de leads que entraram no funil no período = os que seguem vivos/ganharam
  // (topPassage) + os perdidos. Dividir só por topPassage (como era antes) inflava
  // a taxa acima de 100% quando havia mais perdas do que leads em aberto no topo.
  const totalEnteredFunnel = topPassage + lostLeads;
  const lostPercentage = totalEnteredFunnel > 0 ? (lostLeads / totalEnteredFunnel) * 100 : 0;

  // Tapering widths to keep the funnel feel without trapezoidal shapes
  const stageWidths = ["w-full", "w-[92%]", "w-[80%]", "w-[66%]"];

  return (
    <div className="dashboard-section animate-slide-up">
      <div className="flex items-center justify-between mb-6">
        <h2 className="section-title mb-0">
          <TrendingUp className="w-5 h-5 text-primary-ink" />
          Visão Geral - Funil de Passagem
          <SectionTooltip text="Funil de passagem: cada etapa mostra o total de leads que JÁ PASSARAM por ela (ou seja, soma os que estão nela com os que avançaram para etapas posteriores). O número menor entre parênteses indica quantos leads estão atualmente nessa etapa. As taxas de conversão refletem o quanto seguiu para a próxima etapa. Clique em uma etapa para ver os leads que estão nela hoje. A bolinha vermelha, quando aparece, mostra quantos leads chegaram até ali e depois foram marcados como perdidos — é uma contagem à parte, não soma no número principal da etapa." />
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Conversão geral:</span>
          <span className="font-extrabold text-primary-ink text-lg">{formatPercentage(conversionRates.overallConversion)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Main Funnel Flow */}
        <div className="lg:col-span-3 flex flex-col items-center">
          {funnelStages.map((stage, index) => {
            const isLast = index === funnelStages.length - 1;
            const accent = stage.id === "venda_ganha" ? wonAccent : (stageAccents[index] || stageAccents[stageAccents.length - 1]);
            const widthClass = stageWidths[index] || stageWidths[stageWidths.length - 1];
            const stageNumber = String(index + 1).padStart(2, "0");

            return (
              <div key={stage.id} className={`${widthClass} flex flex-col items-center relative`}>
                {!!stage.lostHere && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedStage({ title: `Perdidos em "${stage.name}"`, leads: stage.lostHereLeads || [] });
                    }}
                    title={`${stage.lostHere} lead(s) chegaram a "${stage.name}" e depois foram marcados como perdido. Clique para ver a lista.`}
                    className="absolute -top-3 right-[10%] z-10 min-w-[28px] h-7 px-1.5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-sm font-bold shadow-md ring-2 ring-card hover:brightness-110 transition-all"
                  >
                    {stage.lostHere}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedStage({ title: stage.name, leads: stage.leads || [] })}
                  className={`relative w-full text-left rounded-xl border transition-all overflow-hidden cursor-pointer shadow-sm hover:shadow-md hover:brightness-105 ${accent.border} ${accent.bg}`}
                >
                  <div className="relative p-4 flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/80">
                        {isLast ? "Final" : `Etapa ${stageNumber}`}
                      </span>
                      <h3 className="text-base font-bold text-white">
                        {stage.name}
                      </h3>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-extrabold leading-none text-white">
                        {stage.count}
                      </div>
                      {typeof stage.currentCount === "number" && (
                        <div className="text-[11px] font-medium mt-1 text-white/80">
                          <span className="opacity-70">atual:</span> {stage.currentCount}
                        </div>
                      )}
                    </div>
                  </div>
                </button>

                {!isLast && (
                  <div className="h-9 flex flex-col items-center justify-center relative w-full">
                    <div className="w-px h-full bg-border"></div>
                    <div className="absolute bg-card border border-border px-2.5 py-1 rounded-full shadow-sm">
                      <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                        <ArrowDown className={`w-3 h-3 ${accent.icon}`} />
                        {formatPercentage(conversionLabels[index])}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Lost Opportunities Card */}
        <div className="lg:col-span-2">
          <LostOpportunitiesCard total={lostLeads} ratePercentage={lostPercentage} leadsDetail={lostLeadsDetail} />

          {belowLostCard && <div className="mt-4">{belowLostCard}</div>}
        </div>
      </div>

      <LeadListDialog
        open={!!selectedStage}
        onOpenChange={(o) => !o && setSelectedStage(null)}
        title={selectedStage?.title || ""}
        leads={selectedStage?.leads || []}
      />
    </div>
  );
}
