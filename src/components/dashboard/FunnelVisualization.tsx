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
    conversionRates.contatoToQualificando,
    conversionRates.qualificandoToProposta,
    conversionRates.propostaToFechamento,
    conversionRates.fechamentoToVenda,
  ];

  // "Contato Inicial" (funnelStages[0]) já SOMA os leads perdidos desde a mudança
  // que os inclui nessa etapa no backend (kommo-dashboard/index.ts) — ou seja,
  // `topPassage` já é o total de leads que entraram no funil no período, perdidos
  // inclusos. Dividir `lostLeads` de novo por (topPassage + lostLeads), como era
  // antes dessa mudança, contava os perdidos duas vezes e subestimava a taxa pela
  // metade (ex.: 291 perdidos em 409 leads dava 41,6% em vez dos 71,1% reais).
  const topPassage = funnelStages[0]?.count ?? 0;
  const lostPercentage = topPassage > 0 ? (lostLeads / topPassage) * 100 : 0;

  // Tapering widths to keep the funnel feel without trapezoidal shapes
  const stageWidths = ["w-full", "w-[92%]", "w-[84%]", "w-[74%]", "w-[62%]"];
  // Com 5 etapas, encolhe padding/fonte/conector pra caber num espaço vertical
  // parecido com o de 4, em vez de deixar o card mais alto.
  const compact = funnelStages.length > 4;

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
                  <div className={`relative flex justify-between items-center ${compact ? "p-3" : "p-4"}`}>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/80">
                        {isLast ? "Final" : `Etapa ${stageNumber}`}
                      </span>
                      <h3 className={`font-bold text-white ${compact ? "text-sm" : "text-base"}`}>
                        {stage.name}
                      </h3>
                    </div>
                    <div className="text-right">
                      <div className={`font-extrabold leading-none text-white ${compact ? "text-xl" : "text-2xl"}`}>
                        {stage.count}
                      </div>
                      {typeof stage.currentCount === "number" && (
                        <div className={`font-medium text-white/80 ${compact ? "text-[10px] mt-1" : "text-[11px] mt-1"}`}>
                          <span className="opacity-70">atual:</span> {stage.currentCount}
                        </div>
                      )}
                    </div>
                  </div>
                </button>

                {!isLast && (
                  <div className={`flex flex-col items-center justify-center relative w-full ${compact ? "h-7" : "h-9"}`}>
                    <div className="w-px h-full bg-border"></div>
                    <div className={`absolute bg-card border border-border rounded-full shadow-sm ${compact ? "px-2 py-0.5" : "px-2.5 py-1"}`}>
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
