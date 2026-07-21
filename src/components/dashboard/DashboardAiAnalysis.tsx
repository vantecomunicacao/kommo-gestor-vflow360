import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, Clock, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  useParseAnalysis, useRunAnalysis, useAnalysisHistory,
  type AnalysisInterpretation, type AnalysisParams,
} from "@/hooks/useDashboardAnalysis";

interface Props {
  workspaceId: string | null | undefined;
  pipelines: { id: string; name: string }[];
  /** Valores iniciais vindos dos filtros atuais do dashboard (para pré-preencher o prompt). */
  initialDateBasis?: "criacao" | "fechamento";
}

const ALL = "__all__"; // sentinela do Select para "Todos os funis" (Select não aceita value="")

// Converte a interpretação (parse) no estado editável de confirmação.
function toParams(i: AnalysisInterpretation): AnalysisParams {
  return {
    pipelineId: i.pipelineId,
    startDate: i.startDate,
    endDate: i.endDate,
    dateBasis: i.dateBasis,
    compare: i.compare,
    compareStart: i.compareStart,
    compareEnd: i.compareEnd,
    foco: i.foco,
  };
}

function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  try { return format(parseISO(iso), "dd/MM/yy"); } catch { return iso; }
}

export default function DashboardAiAnalysis({ workspaceId, pipelines, initialDateBasis }: Props) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState<AnalysisParams | null>(null); // bloco de confirmação
  const [confirmacao, setConfirmacao] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const parse = useParseAnalysis(workspaceId);
  const run = useRunAnalysis(workspaceId);
  const { data: history = [] } = useAnalysisHistory(workspaceId);

  const setP = (patch: Partial<AnalysisParams>) => setParams((p) => (p ? { ...p, ...patch } : p));

  const handleInterpret = () => {
    if (!prompt.trim()) return;
    setResult(null);
    parse.mutate(prompt.trim(), {
      onSuccess: (r) => {
        const base = toParams(r.interpretation);
        setParams({ ...base, dateBasis: base.dateBasis || initialDateBasis || "criacao" });
        setConfirmacao(r.interpretation.confirmacao || []);
      },
      onError: (e) => toast({ title: "Não consegui interpretar", description: e.message, variant: "destructive" }),
    });
  };

  const handleRun = () => {
    if (!params) return;
    if (params.compare && (!params.compareStart || !params.compareEnd)) {
      toast({ title: "Defina o período de comparação", description: "Informe início e fim da comparação ou desligue a comparação.", variant: "destructive" });
      return;
    }
    run.mutate({ prompt: prompt.trim(), params }, {
      onSuccess: (r) => { setResult(r.result); setParams(null); setConfirmacao([]); },
      onError: (e) => toast({ title: "Falha na análise", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Análise com IA</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            Análise com IA
          </SheetTitle>
          <SheetDescription className="text-xs">
            Descreva o que analisar; a IA confirma o período e o funil antes de gerar.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
      {/* Campo de prompt */}
      <div className="space-y-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Ex.: "Analise junho contra maio, foque nos gargalos e no que caiu"'
          rows={2}
          className="resize-none"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleInterpret} disabled={parse.isPending || !prompt.trim() || !workspaceId}>
            {parse.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-1.5">Interpretar</span>
          </Button>
        </div>
      </div>

      {/* Bloco de confirmação (sempre confirmar antes de gerar) */}
      {params && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">Confirme antes de gerar:</p>

          {confirmacao.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-50/50 p-2 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <ul className="space-y-0.5">{confirmacao.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Funil</Label>
              <Select
                value={params.pipelineId ?? ALL}
                onValueChange={(v) => setP({ pipelineId: v === ALL ? null : v })}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os funis</SelectItem>
                  {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Eixo</Label>
              <Select value={params.dateBasis} onValueChange={(v) => setP({ dateBasis: v as "criacao" | "fechamento" })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="criacao">Por criação (comercial)</SelectItem>
                  <SelectItem value="fechamento">Por fechamento (financeiro)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Início</Label>
              <Input type="date" className="h-9" value={params.startDate} onChange={(e) => setP({ startDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fim</Label>
              <Input type="date" className="h-9" value={params.endDate} onChange={(e) => setP({ endDate: e.target.value })} />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Switch
              id="cmp"
              checked={params.compare}
              onCheckedChange={(v) => setP({ compare: v })}
            />
            <Label htmlFor="cmp" className="text-xs cursor-pointer">Comparar com outro período</Label>
          </div>

          {params.compare && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Comparar — início</Label>
                <Input type="date" className="h-9" value={params.compareStart ?? ""} onChange={(e) => setP({ compareStart: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Comparar — fim</Label>
                <Input type="date" className="h-9" value={params.compareEnd ?? ""} onChange={(e) => setP({ compareEnd: e.target.value })} />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => { setParams(null); setConfirmacao([]); }}>Cancelar</Button>
            <Button size="sm" onClick={handleRun} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="ml-1.5">Confirmar e analisar</span>
            </Button>
          </div>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{result}</p>
        </div>
      )}

      {/* Histórico */}
      {history.length > 0 && (
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Histórico ({history.length})
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {history.map((h) => {
              const p = (h.params || {}) as any;
              return (
                <button
                  key={h.id}
                  onClick={() => { setResult(h.result); setParams(null); }}
                  className="w-full rounded-md border border-border bg-muted/20 p-2 text-left transition-colors hover:bg-muted/40"
                >
                  <p className="line-clamp-1 text-xs font-medium text-foreground">{h.prompt}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {format(parseISO(h.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    {" · "}{p.pipelineName || "Todos os funis"}
                    {" · "}{fmtDay(p.startDate)}–{fmtDay(p.endDate)}
                    {p.compare ? ` vs ${fmtDay(p.compareStart)}–${fmtDay(p.compareEnd)}` : ""}
                  </p>
                </button>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
