import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Snowflake, Clock, Flame, AlertTriangle, CheckCircle2, User, CheckSquare, Tag, Loader2, Check } from "lucide-react";
import { CoolingLeads, CoolingLead } from "@/hooks/useKommoData";
import { SectionTooltip } from "./SectionTooltip";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useKommoAction, KommoActionKind } from "@/hooks/useKommoAction";
import { useToast } from "@/hooks/use-toast";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isDone = (lead: CoolingLead, kind: KommoActionKind) => (kind === "task" ? !!lead.taskDone : !!lead.tagDone);
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface CoolingLeadsCardProps {
  data?: CoolingLeads | null;
}

type BucketKey = "warning" | "alert" | "critical";

export function CoolingLeadsCard({ data }: CoolingLeadsCardProps) {
  const [openBucket, setOpenBucket] = useState<BucketKey | null>(null);
  const t = data?.thresholds ?? { warning: 7, alert: 10, critical: 14 };

  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const action = useKommoAction();
  // Rastreia qual lead+ação está em andamento (ex.: "12345:task") p/ o loading pontual.
  const [pending, setPending] = useState<string | null>(null);
  // Progresso da ação em massa (fila sequencial).
  const [bulk, setBulk] = useState<{ kind: KommoActionKind; done: number; total: number } | null>(null);
  const busy = !!pending || !!bulk;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cooling-leads"] });

  const runAction = async (lead: CoolingLead, kind: KommoActionKind) => {
    if (!activeWorkspace?.id || !lead.kommo_id || busy) return;
    setPending(`${lead.kommo_id}:${kind}`);
    try {
      const res = await action.mutateAsync({
        workspaceId: activeWorkspace.id,
        leadKommoId: lead.kommo_id,
        kind,
        responsibleUserId: lead.responsible_user_id ?? null,
        days: lead.days,
      });
      if (kind === "task") {
        toast({ title: "Tarefa criada no Kommo", description: `"${lead.name}" — na agenda do responsável.` });
      } else {
        toast({
          title: res?.alreadyTagged ? "Lead já estava marcado" : "Tag aplicada no Kommo",
          description: `"${lead.name}"`,
        });
      }
      invalidate();
    } catch (err) {
      toast({
        title: "Falha ao enviar para o Kommo",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setPending(null);
    }
  };

  // Ação em massa: fila sequencial (~220ms entre chamadas p/ respeitar o rate limit do
  // Kommo). Pula os que já têm a ação; cada chamada é idempotente no servidor.
  const runBulk = async (kind: KommoActionKind, leads: CoolingLead[]) => {
    if (!activeWorkspace?.id || busy) return;
    const targets = leads.filter((l) => l.kommo_id && !isDone(l, kind));
    if (targets.length === 0) {
      toast({ title: "Nada a fazer", description: `Todos já têm ${kind === "task" ? "tarefa" : "tag"} nesta faixa.` });
      return;
    }
    setBulk({ kind, done: 0, total: targets.length });
    let ok = 0;
    let fail = 0;
    for (const lead of targets) {
      try {
        await action.mutateAsync({
          workspaceId: activeWorkspace.id,
          leadKommoId: lead.kommo_id!,
          kind,
          responsibleUserId: lead.responsible_user_id ?? null,
          days: lead.days,
        });
        ok++;
      } catch {
        fail++;
      }
      setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
      await sleep(220);
    }
    setBulk(null);
    invalidate();
    toast({
      title: `${kind === "task" ? "Tarefas" : "Tags"} concluídas`,
      description: `${ok} enviada(s)${fail ? `, ${fail} falha(s)` : ""}.`,
      variant: fail ? "destructive" : undefined,
    });
  };

  const tiles: {
    key: BucketKey;
    icon: typeof Clock;
    count: number;
    label: string;
    sub: string;
    cls: string;
    iconCls: string;
  }[] = [
    {
      key: "warning",
      icon: Clock,
      count: data?.warning ?? 0,
      label: `${t.warning}–${t.alert - 1} dias parado`,
      sub: "Atenção",
      cls: "bg-warning/10 text-warning-ink border-warning/30",
      iconCls: "bg-warning/15 text-warning-ink",
    },
    {
      key: "alert",
      icon: AlertTriangle,
      count: data?.alert ?? 0,
      label: `${t.alert}–${t.critical - 1} dias parado`,
      sub: "Alerta",
      cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
      iconCls: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    },
    {
      key: "critical",
      icon: Flame,
      count: data?.critical ?? 0,
      label: `${t.critical}+ dias parado`,
      sub: "Crítico",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
      iconCls: "bg-destructive/15 text-destructive",
    },
  ];

  const activeTile = tiles.find((x) => x.key === openBucket);
  const list: CoolingLead[] = openBucket && data?.leads ? data.leads[openBucket] : [];

  return (
    <div className="dashboard-section animate-slide-up">
      <div className="flex items-center justify-between mb-5 gap-3">
        <h2 className="section-title mb-0">
          <Snowflake className="w-5 h-5 text-primary-ink" />
          Leads esfriando
          <SectionTooltip text={`Oportunidades abertas sem atividade (mudança de etapa ou mensagem) há ${t.warning} dias ou mais. Considera todas as oportunidades em aberto, respeitando os filtros de funil, etapa e vendedor — ignora o período selecionado. Clique em uma faixa para ver os leads.`} />
        </h2>
        {data && data.total > 0 && (
          <span className="text-xs font-semibold text-muted-foreground shrink-0">
            {data.total} no total
          </span>
        )}
      </div>

      {data && data.total === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-8 gap-2">
          <CheckCircle2 className="w-8 h-8 text-success" />
          <p className="text-sm font-medium text-foreground">Nenhum lead esfriando 🎉</p>
          <p className="text-xs text-muted-foreground">Todas as oportunidades abertas tiveram atividade recente.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {tiles.map((tile) => {
            const clickable = tile.count > 0 && !!data?.leads;
            return (
              <button
                key={tile.key}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setOpenBucket(tile.key)}
                className={cn(
                  "rounded-xl border p-4 flex items-center gap-3 text-left transition-shadow",
                  tile.cls,
                  clickable ? "cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current" : "cursor-default opacity-90",
                )}
              >
                <div className={cn("p-2 rounded-lg shrink-0", tile.iconCls)}>
                  <tile.icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold leading-none">{tile.count}</p>
                  <p className="text-xs font-semibold mt-1">{tile.sub}</p>
                  <p className="text-[11px] opacity-80 truncate">{tile.label}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!openBucket} onOpenChange={(o) => !o && setOpenBucket(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeTile && <activeTile.icon className="w-4 h-4" />}
              Leads — {activeTile?.sub} ({activeTile?.label})
            </DialogTitle>
            <DialogDescription>
              {list.length === 0
                ? "Sem leads nesta faixa."
                : `${list.length}${list.length === 100 ? "+" : ""} oportunidade(s), ordenadas pelas mais paradas.`}
            </DialogDescription>
          </DialogHeader>

          {list.some((l) => !!l.kommo_id) && (
            <div className="flex items-center flex-wrap gap-2 pb-1">
              {bulk ? (
                <span className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {bulk.kind === "task" ? "Criando tarefas" : "Aplicando tags"}… {bulk.done}/{bulk.total}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runBulk("task", list)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    Criar tarefa p/ todos
                    <span className="opacity-70">({list.filter((l) => l.kommo_id && !l.taskDone).length})</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runBulk("tag", list)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    Aplicar tag p/ todos
                    <span className="opacity-70">({list.filter((l) => l.kommo_id && !l.tagDone).length})</span>
                  </button>
                </>
              )}
            </div>
          )}
          <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 divide-y divide-border">
            {list.map((lead, i) => {
              const canAct = !!activeWorkspace?.id && !!lead.kommo_id;
              const taskLoading = pending === `${lead.kommo_id}:task`;
              const tagLoading = pending === `${lead.kommo_id}:tag`;
              return (
                <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{lead.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                      <User className="w-3 h-3 shrink-0" />
                      {lead.seller || "Não atribuído"}
                    </p>
                    {(lead.pipeline || lead.stage) && (
                      <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
                        {lead.pipeline}{lead.pipeline && lead.stage ? " · " : ""}{lead.stage}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap mr-1">
                      {lead.days} dias
                    </span>
                    {canAct && (
                      <>
                        <button
                          type="button"
                          disabled={busy || !!lead.taskDone}
                          onClick={() => runAction(lead, "task")}
                          title={lead.taskDone ? "Tarefa já criada" : "Criar tarefa no Kommo"}
                          aria-label={lead.taskDone ? `Tarefa já criada para ${lead.name}` : `Criar tarefa no Kommo para ${lead.name}`}
                          className={cn(
                            "p-1.5 rounded-md border transition-colors disabled:opacity-60",
                            lead.taskDone
                              ? "border-success/30 text-success"
                              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                          )}
                        >
                          {taskLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : lead.taskDone ? <Check className="w-3.5 h-3.5" />
                            : <CheckSquare className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          disabled={busy || !!lead.tagDone}
                          onClick={() => runAction(lead, "tag")}
                          title={lead.tagDone ? "Tag já aplicada" : "Aplicar tag no Kommo"}
                          aria-label={lead.tagDone ? `Tag já aplicada para ${lead.name}` : `Aplicar tag no Kommo para ${lead.name}`}
                          className={cn(
                            "p-1.5 rounded-md border transition-colors disabled:opacity-60",
                            lead.tagDone
                              ? "border-success/30 text-success"
                              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                          )}
                        >
                          {tagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : lead.tagDone ? <Check className="w-3.5 h-3.5" />
                            : <Tag className="w-3.5 h-3.5" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
