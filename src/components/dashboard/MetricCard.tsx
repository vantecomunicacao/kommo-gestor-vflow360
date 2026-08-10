import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionTooltip } from "./SectionTooltip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; isPositive: boolean };
  variant?: "default" | "accent" | "success" | "warning" | "destructive";
  tooltip?: string;
  className?: string;
}

export function MetricCard({
  title, value, subtitle, icon: Icon, trend, variant = "default", tooltip, className,
}: MetricCardProps) {
  const iconBgVariants = {
    default: "bg-primary/10 text-primary-ink",
    accent: "bg-accent/10 text-accent-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning-ink",
    destructive: "bg-destructive/10 text-destructive",
  };
  // Só tinge o valor quando a cor carrega um julgamento (bom/ruim/atenção) —
  // "accent"/"default" ficam com a cor de texto padrão, sem destaque.
  const valueColorVariants = {
    default: "",
    accent: "",
    success: "text-success",
    warning: "text-warning-ink",
    destructive: "text-destructive",
  };

  return (
    <div className={cn("metric-card animate-slide-up", className)}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={cn("p-1.5 rounded-md shrink-0", iconBgVariants[variant])}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <p className="metric-label truncate">{title}</p>
        {tooltip && <SectionTooltip text={tooltip} />}
      </div>
      <div className="flex items-baseline gap-2 mt-2 min-w-0">
        <p className={cn("metric-value truncate", valueColorVariants[variant])}>{value}</p>
        {trend && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-help shrink-0 self-center",
                    trend.isPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                  )}
                >
                  {trend.isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {Math.abs(trend.value)}%
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs leading-relaxed">
                Comparação com o período anterior de mesma duração.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {subtitle && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</p>}
    </div>
  );
}
