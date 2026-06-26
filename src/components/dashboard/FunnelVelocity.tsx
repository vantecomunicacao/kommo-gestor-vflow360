import { FunnelVelocity as FV } from "@/hooks/useKommoData";
import { Gauge, ArrowUpRight, MoveRight, Trophy, XCircle } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";

interface FunnelVelocityProps { velocity?: FV; }

export function FunnelVelocity({ velocity }: FunnelVelocityProps) {
  const v = velocity || { movimentacoes: 0, leadsMovidos: 0, avancaram: 0, ganhos: 0, perdidos: 0 };
  const tiles = [
    { label: "Leads que avançaram", value: v.avancaram, icon: ArrowUpRight },
    { label: "Leads movimentados", value: v.leadsMovidos, icon: MoveRight },
    { label: "Movimentações", value: v.movimentacoes, icon: Gauge },
    { label: "Ganhos no período", value: v.ganhos, icon: Trophy },
    { label: "Perdidos no período", value: v.perdidos, icon: XCircle },
  ];

  return (
    <div className="dashboard-section animate-slide-up">
      <h2 className="section-title">
        <Gauge className="w-5 h-5 text-primary-ink" />
        Velocidade do Funil
        <SectionTooltip text="Movimentação do funil no período selecionado: quantos leads avançaram de etapa, total de mudanças, e fechamentos (ganhos/perdidos). Baseado no histórico real de eventos do CRM." />
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mt-4">
        {tiles.map((t) => (
          <div key={t.label} className="border rounded-2xl p-3 bg-card/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
              <t.icon className="w-4 h-4 shrink-0" />
              <span className="text-[11px] font-medium leading-tight">{t.label}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums text-foreground">{t.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
