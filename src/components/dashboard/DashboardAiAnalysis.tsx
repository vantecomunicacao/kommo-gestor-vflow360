import { useMemo, useState } from "react";
import { Sparkles, Loader2, ChevronDown, Clock, AlertTriangle, Send, MessageCircle, Maximize2, Minimize2, RotateCcw, Trash2, Star, Search, Lightbulb } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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
import AnalysisReport from "@/components/dashboard/AnalysisReport";
import { useQueryClient } from "@tanstack/react-query";
import {
  useParseAnalysis, useRunAnalysis, useAnalysisHistory, useFollowup, useDeleteAnalysis, usePinAnalysis, streamAnalyze,
  type AnalysisInterpretation, type AnalysisParams, type AnalysisMetrics, type ChatMessage, type AnalysisRecord,
} from "@/hooks/useDashboardAnalysis";

interface Props {
  workspaceId: string | null | undefined;
  pipelines: { id: string; name: string }[];
  /** Valores iniciais vindos dos filtros atuais do dashboard (para pré-preencher o prompt). */
  initialDateBasis?: "criacao" | "fechamento";
}

const ALL = "__all__"; // sentinela do Select para "Todos os funis" (Select não aceita value="")

// Sugestões (mini-prompts) que o gestor pode clicar para partir de um pedido pronto.
const SUGGESTIONS: string[] = [
  "Onde estou perdendo mais vendas e por quê?",
  "Compare o mês passado com o mês anterior",
  "Quais os principais gargalos do funil?",
  "Qual vendedor está convertendo melhor?",
  "Analise a receita: ganha, perdida e em negociação",
  "Como está minha conversão vs. o período anterior?",
];

interface Report {
  id: string | null;
  prompt: string;
  result: string;
  metrics: AnalysisMetrics | null;
  params: Record<string, unknown> | null;
  messages: ChatMessage[];
}

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

// Título curto para o item do histórico: 1ª frase do RESUMO EXECUTIVO; senão, o comando.
function historyTitle(rec: AnalysisRecord): string {
  const lines = (rec.result || "").split("\n").map((l) => l.trim());
  const idx = lines.findIndex((l) => /^#{1,3}\s*RESUMO/i.test(l));
  if (idx >= 0) {
    const body = lines.slice(idx + 1).find((l) => l && !/^#{1,3}\s/.test(l));
    if (body) return body.replace(/\*\*/g, "").replace(/^[-*]\s+/, "").slice(0, 90);
  }
  return rec.prompt;
}

// Frase em linguagem natural do que será analisado (bloco de confirmação).
function confirmSummary(p: AnalysisParams, pipelineName: string): string {
  const eixo = p.dateBasis === "fechamento" ? "por fechamento" : "por criação";
  const per = `${fmtDay(p.startDate)} a ${fmtDay(p.endDate)}`;
  const cmp = p.compare && p.compareStart && p.compareEnd ? `, comparando com ${fmtDay(p.compareStart)} a ${fmtDay(p.compareEnd)}` : "";
  return `Vou analisar ${pipelineName} de ${per}${cmp}, ${eixo}.`;
}

/** Formato solto do `params` salvo em `kommo.dashboard_analyses` (jsonb, sem schema fixo). */
interface SavedAnalysisParams {
  pipelineId?: string | null;
  pipelineName?: string;
  startDate?: string;
  endDate?: string;
  dateBasis?: string;
  compare?: boolean;
  compareStart?: string | null;
  compareEnd?: string | null;
  foco?: string;
}

// Reconstrói AnalysisParams a partir do params salvo (para o Regenerar).
function paramsFromSaved(pr: Record<string, unknown> | null): AnalysisParams | null {
  if (!pr) return null;
  const s = pr as SavedAnalysisParams;
  if (!s.startDate || !s.endDate) return null;
  return {
    pipelineId: s.pipelineId ?? null,
    startDate: s.startDate, endDate: s.endDate,
    dateBasis: s.dateBasis === "fechamento" ? "fechamento" : "criacao",
    compare: !!s.compare, compareStart: s.compareStart ?? null, compareEnd: s.compareEnd ?? null,
    foco: s.foco ?? "",
  };
}

export default function DashboardAiAnalysis({ workspaceId, pipelines, initialDateBasis }: Props) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState<AnalysisParams | null>(null); // bloco de confirmação
  const [confirmacao, setConfirmacao] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [followupText, setFollowupText] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState(""); // texto sobrevive à limpeza da caixa

  const queryClient = useQueryClient();
  const parse = useParseAnalysis(workspaceId);
  const run = useRunAnalysis(workspaceId);
  const followup = useFollowup(workspaceId);
  const del = useDeleteAnalysis(workspaceId);
  const pin = usePinAnalysis(workspaceId);
  const { data: history = [] } = useAnalysisHistory(workspaceId);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => {
      const pm = (h.params || {}) as SavedAnalysisParams;
      return `${h.prompt} ${pm.pipelineName ?? ""} ${h.result ?? ""}`.toLowerCase().includes(q);
    });
  }, [history, historySearch]);

  const setP = (patch: Partial<AnalysisParams>) => setParams((p) => (p ? { ...p, ...patch } : p));

  const interpret = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setReport(null);
    setPendingPrompt(q);
    parse.mutate(q, {
      onSuccess: (r) => {
        const base = { ...toParams(r.interpretation), dateBasis: toParams(r.interpretation).dateBasis || initialDateBasis || "criacao" };
        // Pergunta direta → responde na hora, sem a etapa de confirmação de período/funil.
        if (r.interpretation.intent === "pergunta") {
          setParams(null); setConfirmacao([]);
          runAnalysis(q, { ...base, intent: "pergunta" });
          return;
        }
        setParams(base);
        setConfirmacao(r.interpretation.confirmacao || []);
      },
      onError: (e) => toast({ title: "Não consegui interpretar", description: e.message, variant: "destructive" }),
    });
  };

  const handleInterpret = () => { const q = prompt; interpret(q); setPrompt(""); };

  // Sugestão só PREENCHE o campo — o gestor decide clicar em Analisar.
  const handleSuggestion = (text: string) => setPrompt(text);

  // Roda a análise em streaming (texto incremental); em falha, cai no modo não-stream.
  const runAnalysis = async (q: string, p: AnalysisParams) => {
    if (!workspaceId) return;
    setStreaming(true);
    setReport({ id: null, prompt: q, result: "", metrics: null, params: null, messages: [] });
    try {
      await streamAnalyze(workspaceId, q, p, {
        onMeta: (m) => setReport((r) => (r ? { ...r, prompt: m.prompt, params: m.params, metrics: m.metrics } : r)),
        onDelta: (t) => setReport((r) => (r ? { ...r, result: r.result + t } : r)),
        onDone: (d) => {
          setReport((r) => (r ? { ...r, id: d.id } : r));
          queryClient.invalidateQueries({ queryKey: ["dashboard-analyses", workspaceId] });
          if (d.historySaveFailed) {
            toast({ title: "Análise gerada, mas não salva", description: "Não foi possível gravar esta análise no histórico. O resultado está na tela, mas não ficará salvo.", variant: "destructive" });
          }
        },
      });
    } catch {
      // Fallback: caminho não-stream (JSON de uma vez).
      run.mutate({ prompt: q, params: p }, {
        onSuccess: (r) => {
          setReport({ id: r.id, prompt: r.prompt, result: r.result, metrics: r.metrics, params: r.params, messages: r.messages || [] });
          if (r.historySaveFailed) {
            toast({ title: "Análise gerada, mas não salva", description: "Não foi possível gravar esta análise no histórico. O resultado está na tela, mas não ficará salvo.", variant: "destructive" });
          }
        },
        onError: (e) => { setReport(null); toast({ title: "Falha na análise", description: e.message, variant: "destructive" }); },
      });
    } finally {
      setStreaming(false);
    }
  };

  const handleRun = () => {
    if (!params) return;
    if (params.compare && (!params.compareStart || !params.compareEnd)) {
      toast({ title: "Defina o período de comparação", description: "Informe início e fim da comparação ou desligue a comparação.", variant: "destructive" });
      return;
    }
    const p = params;
    setParams(null); setConfirmacao([]); setFollowupText("");
    runAnalysis(pendingPrompt || prompt.trim(), p);
  };

  const handleFollowup = () => {
    const q = followupText.trim();
    if (!q || !report?.id) return;
    followup.mutate({ analysisId: report.id, question: q }, {
      onSuccess: (r) => {
        setReport((rep) => (rep ? { ...rep, messages: r.messages } : rep));
        setFollowupText("");
      },
      onError: (e) => toast({ title: "Não consegui responder", description: e.message, variant: "destructive" }),
    });
  };

  const handleRegenerate = () => {
    if (!report) return;
    const rp = paramsFromSaved(report.params);
    if (!rp) { toast({ title: "Não consegui regenerar", description: "Parâmetros da análise indisponíveis.", variant: "destructive" }); return; }
    runAnalysis(report.prompt, rp);
  };

  const handleDelete = (id: string) => {
    if (report?.id === id) setReport(null);
    del.mutate(id, { onError: (e) => toast({ title: "Falha ao excluir", description: e.message, variant: "destructive" }) });
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          size="icon"
          aria-label="Análise com IA"
          title="Análise com IA"
          className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:shadow-xl"
        >
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className={`w-full overflow-y-auto transition-[max-width] duration-300 ${expanded ? "sm:max-w-3xl" : "sm:max-w-md"}`}
      >
        {/* Expandir/recolher para o lado (fica à esquerda do X de fechar) */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="absolute right-11 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label={expanded ? "Recolher painel" : "Expandir painel"}
          title={expanded ? "Recolher" : "Expandir"}
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
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
          className="resize-none bg-card"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleInterpret} disabled={parse.isPending || !prompt.trim() || !workspaceId}>
            {parse.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-1.5">Analisar</span>
          </Button>
        </div>
      </div>

      {/* Empty state — orienta quando ainda não há nada na tela */}
      {!params && !report && !run.isPending && !streaming && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-card p-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            Escreva o que quer entender do seu comercial (ou toque numa sugestão abaixo). A IA vai
            confirmar o funil e o período antes de gerar o relatório.
          </p>
        </div>
      )}

      {/* Sugestões (mini-prompts) — só no estado inicial; somem quando há análise/geração */}
      {!params && !report && !run.isPending && !streaming && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sugestões</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                disabled={parse.isPending || !workspaceId}
                className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bloco de confirmação (sempre confirmar antes de gerar) */}
      {params && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-medium text-foreground">Confirme antes de gerar:</p>

          <p className="rounded-md bg-primary/5 px-2.5 py-1.5 text-xs text-foreground">
            {confirmSummary(params, params.pipelineId ? (pipelines.find((pp) => pp.id === params.pipelineId)?.name ?? "o funil") : "Todos os funis")}
          </p>

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

      {/* Skeleton enquanto gera a análise (ou streaming ainda sem texto) */}
      {(run.isPending || (streaming && !report?.result)) && (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full rounded-lg bg-foreground/10" />
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg bg-foreground/10" />)}
          </div>
          <Skeleton className="h-28 w-full rounded-lg bg-foreground/10" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-1/3 bg-foreground/10" /><Skeleton className="h-3 w-full bg-foreground/10" /><Skeleton className="h-3 w-5/6 bg-foreground/10" />
          </div>
        </div>
      )}

      {/* Resultado (relatório: KPIs + gráfico + texto formatado) */}
      {report && !run.isPending && (report.result.length > 0 || !streaming) && (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            {streaming && <span className="mr-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> gerando…</span>}
            <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={handleRegenerate} disabled={run.isPending || streaming || !paramsFromSaved(report.params)}>
              <RotateCcw className="h-3.5 w-3.5" /> Regenerar
            </Button>
          </div>
          <AnalysisReport result={report.result} metrics={report.metrics} params={report.params} prompt={report.prompt} />

          {/* Conversa de acompanhamento (ancorada nesta análise) */}
          {report.id && (
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <MessageCircle className="h-3.5 w-3.5" /> Continuar a conversa
              </p>

              {report.messages.length > 0 && (
                <div className="space-y-2">
                  {report.messages.map((m, i) => (
                    <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                      <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm leading-relaxed ${m.role === "user" ? "bg-primary/10 text-foreground" : "border border-border bg-card text-foreground"}`}>
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2">
                <Textarea
                  value={followupText}
                  onChange={(e) => setFollowupText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleFollowup(); } }}
                  placeholder="Pergunte mais sobre esta análise…"
                  rows={1}
                  className="min-h-9 resize-none bg-card"
                />
                <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleFollowup} disabled={followup.isPending || !followupText.trim()}>
                  {followup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Usa os mesmos números desta análise — não re-consulta o CRM. Para outro período/funil, gere uma nova análise.</p>
            </div>
          )}
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
            {history.length > 3 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Buscar no histórico…"
                  className="h-8 bg-card pl-7 text-xs"
                />
              </div>
            )}
            {filteredHistory.length === 0 && (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">Nenhuma análise encontrada.</p>
            )}
            {filteredHistory.map((h) => {
              const p = (h.params || {}) as SavedAnalysisParams;
              const isPinned = !!h.pinned;
              return (
                <div key={h.id} className="group relative rounded-md border border-border bg-card transition-colors hover:bg-muted/40">
                  <button
                    onClick={() => { setReport({ id: h.id, prompt: h.prompt, result: h.result, metrics: h.metrics, params: h.params, messages: h.messages || [] }); setParams(null); setConfirmacao([]); setFollowupText(""); }}
                    className="w-full p-2 pr-14 text-left"
                  >
                    <p className="line-clamp-1 text-xs font-medium text-foreground">{historyTitle(h)}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {format(parseISO(h.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                      {" · "}{p.pipelineName || "Todos os funis"}
                      {" · "}{fmtDay(p.startDate)}–{fmtDay(p.endDate)}
                      {p.compare ? ` vs ${fmtDay(p.compareStart)}–${fmtDay(p.compareEnd)}` : ""}
                    </p>
                  </button>
                  <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
                    <button
                      onClick={() => pin.mutate({ analysisId: h.id, pinned: !isPinned })}
                      title={isPinned ? "Desafixar" : "Fixar no topo"}
                      className={`rounded p-1 transition-colors hover:bg-background ${isPinned ? "text-amber-500" : "text-muted-foreground opacity-0 group-hover:opacity-100"}`}
                    >
                      <Star className={`h-3.5 w-3.5 ${isPinned ? "fill-amber-500" : ""}`} />
                    </button>
                    <button
                      onClick={() => handleDelete(h.id)}
                      title="Excluir"
                      className="rounded p-1 text-muted-foreground opacity-0 transition-colors hover:bg-background hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
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
