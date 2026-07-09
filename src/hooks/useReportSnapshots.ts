import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type { DateBasis } from "@/lib/report-axis";
import type { DateBasis } from "@/lib/report-axis";

export interface ReachStage { id: string; label: string; count: number }

export interface ReportMetrics {
  leads: number;
  won: number;
  wonRevenue: number;
  lost: number;
  lostRevenue: number;
  ticket: number;
  winRate: number;
  reached?: ReachStage[]; // safra por criação: quantos alcançaram cada etapa-alvo
  bySeller?: Record<string, ReportMetrics>; // sub-bloco por vendedor (id -> métricas)
}

export interface ReportMonth {
  month: string;      // "YYYY-MM-DD" (1º dia do mês)
  isPartial: boolean;
  frozenAt: string;
  metrics: ReportMetrics;
}

const EMPTY: ReportMetrics = { leads: 0, won: 0, wonRevenue: 0, lost: 0, lostRevenue: 0, ticket: 0, winRate: 0 };

function normalize(raw: unknown, withSellers = true): ReportMetrics {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const reached = Array.isArray(m.reached)
    ? (m.reached as unknown[]).map((r) => {
        const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
        return { id: String(o.id ?? ""), label: String(o.label ?? o.id ?? ""), count: num(o.count) };
      }).filter((r) => r.id)
    : undefined;
  let bySeller: Record<string, ReportMetrics> | undefined;
  if (withSellers && m.bySeller && typeof m.bySeller === "object") {
    bySeller = {};
    for (const [sid, sub] of Object.entries(m.bySeller as Record<string, unknown>)) {
      bySeller[sid] = normalize(sub, false);
    }
  }
  return {
    leads: num(m.leads),
    won: num(m.won),
    wonRevenue: num(m.wonRevenue),
    lost: num(m.lost),
    lostRevenue: num(m.lostRevenue),
    ticket: num(m.ticket),
    winRate: num(m.winRate),
    reached,
    bySeller,
  };
}

/** Lê as fotos mensais congeladas de kommo.report_snapshots para um eixo e funil. */
export function useReportSnapshots(workspaceId: string | null, dateBasis: DateBasis, pipelineId = "__all__") {
  const query = useQuery<ReportMonth[], Error>({
    queryKey: ["report-snapshots", workspaceId, dateBasis, pipelineId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_snapshots")
        .select("month, is_partial, frozen_at, metrics")
        .eq("workspace_id", workspaceId!)
        .eq("date_basis", dateBasis)
        .eq("pipeline_id", pipelineId)
        .order("month", { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        month: r.month as string,
        isPartial: !!r.is_partial,
        frozenAt: r.frozen_at as string,
        metrics: normalize(r.metrics),
      }));
    },
  });

  return {
    months: useMemo(() => query.data ?? [], [query.data]),
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
    refetch: query.refetch,
  };
}

export { EMPTY as EMPTY_METRICS };
