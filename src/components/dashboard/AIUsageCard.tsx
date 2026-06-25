// @ts-nocheck — "futuramente": depende de tabelas/funcs do schema antigo (public/GHL) ainda não migradas para kommo. Página não priorizada nesta fase.
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface Props {
  startDate: Date;
  endDate: Date;
}

export function AIUsageCard({ startDate, endDate }: Props) {
  const { activeWorkspace } = useWorkspace();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-usage", activeWorkspace?.id, startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      if (!activeWorkspace) return [];
      const { data, error } = await supabase
        .from("ai_usage_log")
        .select("provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd")
        .eq("workspace_id", activeWorkspace.id)
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString())
        .limit(10000);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!activeWorkspace,
    staleTime: 60_000,
  });

  const rows = data ?? [];

  const totals = rows.reduce(
    (acc, r) => {
      acc.calls += 1;
      acc.prompt += r.prompt_tokens || 0;
      acc.completion += r.completion_tokens || 0;
      acc.total += r.total_tokens || 0;
      acc.cost += Number(r.cost_usd || 0);
      return acc;
    },
    { calls: 0, prompt: 0, completion: 0, total: 0, cost: 0 }
  );

  const byModel = new Map<string, { calls: number; tokens: number; cost: number }>();
  for (const r of rows) {
    const key = `${r.provider}/${r.model}`;
    const cur = byModel.get(key) || { calls: 0, tokens: 0, cost: 0 };
    cur.calls += 1;
    cur.tokens += r.total_tokens || 0;
    cur.cost += Number(r.cost_usd || 0);
    byModel.set(key, cur);
  }

  const fmtUsd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
  const fmtNum = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 rounded-lg bg-primary/10">
          <Sparkles className="h-5 w-5 text-primary-ink" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Consumo de IA (Sugestões)</h2>
          <p className="text-xs text-muted-foreground">No período filtrado · custo estimado</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : totals.calls === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma análise de IA registrada neste período.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="Chamadas" value={fmtNum(totals.calls)} />
            <Stat label="Tokens totais" value={fmtNum(totals.total)} />
            <Stat label="Entrada / Saída" value={`${fmtNum(totals.prompt)} / ${fmtNum(totals.completion)}`} />
            <Stat label="Custo estimado" value={fmtUsd(totals.cost)} highlight />
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Por modelo</p>
            <div className="space-y-2">
              {[...byModel.entries()].map(([key, v]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="text-foreground font-medium">{key}</span>
                  <span className="text-muted-foreground">
                    {fmtNum(v.calls)} chamadas · {fmtNum(v.tokens)} tokens · <span className="text-foreground">{fmtUsd(v.cost)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${highlight ? "text-primary-ink" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
