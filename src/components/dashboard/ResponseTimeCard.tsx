import { useState } from "react";
import { Clock, TrendingDown, TrendingUp, MessageCircleReply, User, ChevronRight } from "lucide-react";
import { ResponseTime as RT } from "@/hooks/useKommoData";
import { SectionTooltip } from "./SectionTooltip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ResponseTimeCardProps {
  responseTime: RT | null | undefined;
  prevResponseTime?: RT | null;
}

function formatDuration(minutes: number): { value: string; unit: string } {
  if (!isFinite(minutes) || minutes <= 0) return { value: "—", unit: "" };
  if (minutes < 1) return { value: "<1", unit: "min" };
  if (minutes < 60) return { value: Math.round(minutes).toString(), unit: "min" };
  const hours = minutes / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return { value: m > 0 ? `${h}h ${m}m` : `${h}h`, unit: "" };
  }
  const days = hours / 24;
  return { value: days.toFixed(1), unit: "dias" };
}

export function ResponseTimeCard({ responseTime, prevResponseTime }: ResponseTimeCardProps) {
  const [showUnanswered, setShowUnanswered] = useState(false);
  const minutes = responseTime?.averageMinutes ?? 0;
  const { value, unit } = formatDuration(minutes);
  const responses = responseTime?.responseCount ?? 0;
  const convs = responseTime?.conversationsAnalyzed ?? 0;
  const start = responseTime?.businessHoursStart || "09:00";
  const end = responseTime?.businessHoursEnd || "18:00";

  const prevMinutes = prevResponseTime?.averageMinutes ?? 0;
  const trend = (() => {
    if (minutes <= 0 || prevMinutes <= 0) return null;
    const diff = ((minutes - prevMinutes) / prevMinutes) * 100;
    if (Math.abs(diff) < 0.1) return null;
    return {
      value: Math.round(Math.abs(diff) * 10) / 10,
      faster: diff < 0,
    };
  })();

  const withInbound = responseTime?.conversationsWithInbound ?? 0;
  const responseRate = withInbound > 0 ? (convs / withInbound) * 100 : null;
  const unanswered = responseTime?.unanswered ?? [];
  const unansweredCount = unanswered.length;
  const rateColor =
    responseRate === null ? "text-muted-foreground"
    : responseRate >= 70 ? "text-success"
    : responseRate >= 40 ? "text-warning-ink"
    : "text-destructive";
  const rateBarColor =
    responseRate === null ? "bg-muted"
    : responseRate >= 70 ? "bg-success"
    : responseRate >= 40 ? "bg-warning"
    : "bg-destructive";

  const prevWithInbound = prevResponseTime?.conversationsWithInbound ?? 0;
  const prevConvs = prevResponseTime?.conversationsAnalyzed ?? 0;
  const prevResponseRate = prevWithInbound > 0 ? (prevConvs / prevWithInbound) * 100 : null;
  const rateTrend = (() => {
    if (responseRate === null || prevResponseRate === null) return null;
    const diff = responseRate - prevResponseRate;
    if (Math.abs(diff) < 0.1) return null;
    return {
      value: Math.round(Math.abs(diff) * 10) / 10,
      isPositive: diff > 0,
    };
  })();

  return (
    <div className="dashboard-section animate-slide-up h-full flex flex-col">
      <h2 className="section-title">
        <Clock className="w-5 h-5 text-primary-ink" />
        Tempo médio de resposta
        <SectionTooltip text={`Tempo médio que o vendedor (número conectado) leva para responder o cliente. Considera conversas dos leads do funil/etapa filtrado(a). Sem pipeline selecionado, restringe às etapas mapeadas no funil comercial. Expediente: ${start} às ${end}.`} />
      </h2>

      <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
        {responses === 0 ? (
          <p className="text-muted-foreground text-sm py-8">
            Sem dados de resposta no período.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold text-foreground tabular-nums">{value}</span>
              {unit && <span className="text-xl text-muted-foreground font-semibold">{unit}</span>}
            </div>
            {trend && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "mt-3 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full cursor-help",
                        trend.faster ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {trend.faster ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                      {trend.value}% {trend.faster ? "mais rápido" : "mais lento"}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs leading-relaxed">
                    Comparação com o período anterior de mesma duração.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Baseado em <span className="font-bold text-foreground">{responses}</span> resposta{responses === 1 ? "" : "s"}
              {convs > 0 && <> em <span className="font-bold text-foreground">{convs}</span> conversa{convs === 1 ? "" : "s"}</>}
            </p>

            {/* Taxa de resposta temporariamente oculta — em desenvolvimento. */}
            <div className="w-full max-w-[260px] mt-5 pt-4 border-t border-border">
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <MessageCircleReply className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Taxa de resposta</span>
                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  em breve
                </span>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground mt-4">
              Expediente: {start} – {end}
            </p>
          </>
        )}
      </div>

      <Dialog open={showUnanswered} onOpenChange={setShowUnanswered}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircleReply className="w-4 h-4 text-destructive" />
              Clientes sem resposta
            </DialogTitle>
            <DialogDescription>
              {unanswered.length === 0
                ? "Nenhuma conversa sem resposta."
                : `${unansweredCount} cliente(s) que mandaram mensagem e seguem sem resposta até hoje. Ordenados pelo maior tempo de espera.`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 divide-y divide-border">
            {unanswered.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <User className="w-3 h-3 shrink-0" />
                    {c.seller || "Não atribuído"}
                  </p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground shrink-0 whitespace-nowrap">
                  {c.waitingDays === 0 ? "hoje" : `há ${c.waitingDays} dia${c.waitingDays === 1 ? "" : "s"}`}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
