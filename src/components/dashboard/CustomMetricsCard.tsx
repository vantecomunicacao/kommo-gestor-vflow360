import { Link } from "react-router-dom";
import { Sparkles, SlidersHorizontal } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";
import { MetricCard } from "./MetricCard";
import { CustomMetricResult } from "@/hooks/useKommoData";
import { formatCustomMetricValue, getCustomMetricIcon } from "@/lib/custom-metrics";
import { Button } from "@/components/ui/button";

interface CustomMetricsCardProps {
  metrics: CustomMetricResult[];
}

export function CustomMetricsCard({ metrics }: CustomMetricsCardProps) {
  return (
    <div className="dashboard-section animate-slide-up h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title mb-0">
          <Sparkles className="w-5 h-5 text-primary-ink" />
          Métricas Personalizadas
          <SectionTooltip text="Métricas que você cria para o seu negócio, configuráveis em Personalizar." />
        </h2>
      </div>

      {metrics.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center gap-2 py-6">
          <p className="text-sm text-muted-foreground">Nenhuma métrica configurada ainda.</p>
          <Button variant="outline" size="sm" className="h-8 px-3 gap-1.5 text-xs" asChild>
            <Link to="/settings/dashboard">
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              Configurar em Personalizar
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {metrics.map((m) => (
            <MetricCard
              key={m.id}
              title={m.name}
              value={formatCustomMetricValue(m.value, m.format)}
              icon={getCustomMetricIcon(m.icon)}
              variant="accent"
            />
          ))}
        </div>
      )}
    </div>
  );
}
