// @ts-nocheck — "futuramente": depende de tabelas/funcs do schema antigo (public/GHL) ainda não migradas para kommo. Página não priorizada nesta fase.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Brain, Loader2, RotateCcw, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/hooks/use-toast";

// Defaults de FOCO (devem espelhar os da edge ai-insights-generate). "" no banco
// = usa o padrao da edge; aqui usamos o texto para o botao "Resetar" preencher.
const DEFAULT_FUNNEL_PROMPT =
  "Analise a saúde deste funil: gargalos por etapa, taxa de ganho, leads parados (envelhecimento) e variação vs. a semana anterior. Destaque o que precisa de ação.";
const DEFAULT_COMBINED_PROMPT =
  "Dê uma visão geral do volume do negócio somando os funis acompanhados: total de leads novos, valor ganho e em aberto, e variação vs. a semana anterior. Foque em volume/receita, nunca em conversão misturada.";

interface PipelineRow { ghl_id: string; name: string }
interface AnalystConfig {
  enabled?: boolean;
  combined?: { prompt?: string };
  pipelines?: Array<{ id: string; prompt?: string }>;
}

export const AiAnalystConfig = () => {
  const { activeWorkspace } = useWorkspace();
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  // mapa id -> prompt (presenca = funil selecionado)
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [combinedPrompt, setCombinedPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeWorkspace) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: pipes }, { data: settings }] = await Promise.all([
        supabase.from("ghl_pipelines").select("ghl_id, name").eq("workspace_id", activeWorkspace.id).order("name"),
        (supabase.from("ghl_dashboard_settings") as any).select("ai_insights_config").eq("workspace_id", activeWorkspace.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const cfg = ((settings?.ai_insights_config as AnalystConfig) || {});
      setPipelines((pipes as PipelineRow[]) || []);
      setEnabled(!!cfg.enabled);
      const m = new Map<string, string>();
      for (const p of cfg.pipelines || []) if (p?.id) m.set(p.id, p.prompt || "");
      setSelected(m);
      setCombinedPrompt(cfg.combined?.prompt || "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeWorkspace]);

  const togglePipeline = (id: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, "");
      return next;
    });
  };
  const setPipelinePrompt = (id: string, prompt: string) => {
    setSelected((prev) => { const next = new Map(prev); next.set(id, prompt); return next; });
  };

  const save = async () => {
    if (!activeWorkspace) return;
    setSaving(true);
    try {
      const config: AnalystConfig = {
        enabled,
        combined: { prompt: combinedPrompt.trim() },
        pipelines: Array.from(selected.entries()).map(([id, prompt]) => ({ id, prompt: prompt.trim() })),
      };
      const { error } = await (supabase.from("ghl_dashboard_settings") as any)
        .upsert({ workspace_id: activeWorkspace.id, ai_insights_config: config }, { onConflict: "workspace_id" });
      if (error) throw error;
      toast({ title: "Analista IA salvo", description: "As configurações foram aplicadas." });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="glass-card p-6"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Analista IA</h3>
            <p className="text-sm text-muted-foreground">
              Análise semanal dos funis: gargalos, tendências e oportunidades no card do Dashboard.
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Ativar Analista IA" />
      </div>

      <div className={`mt-4 space-y-4 ${enabled ? "" : "opacity-50 pointer-events-none"}`}>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando funis...
          </div>
        ) : pipelines.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Nenhum funil sincronizado ainda. Aguarde a próxima sincronização do CRM.
          </p>
        ) : (
          <>
            <Badge variant="outline" className="text-xs">
              {selected.size === 0 ? "Nenhum funil selecionado" : `${selected.size} de ${pipelines.length} funis analisados`}
            </Badge>

            {/* Funis: cada marcado abre seu próprio foco */}
            <div className="space-y-3">
              {pipelines.map((p) => {
                const isOn = selected.has(p.ghl_id);
                return (
                  <div key={p.ghl_id} className="rounded-lg border border-border bg-muted/30 p-3">
                    <label htmlFor={`an-pipe-${p.ghl_id}`} className="flex items-center gap-3 cursor-pointer">
                      <Checkbox id={`an-pipe-${p.ghl_id}`} checked={isOn} onCheckedChange={() => togglePipeline(p.ghl_id)} />
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                    </label>
                    {isOn && (
                      <div className="mt-3 pl-7 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Foco da análise deste funil</span>
                          <Button
                            type="button" variant="ghost" size="sm" className="h-6 text-xs gap-1"
                            onClick={() => setPipelinePrompt(p.ghl_id, DEFAULT_FUNNEL_PROMPT)}
                          >
                            <RotateCcw className="w-3 h-3" /> Resetar
                          </Button>
                        </div>
                        <Textarea
                          value={selected.get(p.ghl_id) || ""}
                          onChange={(e) => setPipelinePrompt(p.ghl_id, e.target.value)}
                          placeholder={DEFAULT_FUNNEL_PROMPT}
                          rows={3}
                          className="text-sm"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Visão combinada */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Visão combinada (todos os marcados)</span>
                </div>
                <Button
                  type="button" variant="ghost" size="sm" className="h-6 text-xs gap-1"
                  onClick={() => setCombinedPrompt(DEFAULT_COMBINED_PROMPT)}
                >
                  <RotateCcw className="w-3 h-3" /> Resetar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1 mb-2">
                Visão de volume/valor somando os funis marcados. Nunca calcula conversão misturada.
              </p>
              <Textarea
                value={combinedPrompt}
                onChange={(e) => setCombinedPrompt(e.target.value)}
                placeholder={DEFAULT_COMBINED_PROMPT}
                rows={3}
                className="text-sm"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Deixe um foco em branco para usar o padrão. A análise roda 1 vez por semana, separada por funil + uma visão combinada.
            </p>
          </>
        )}
      </div>

      <div className="mt-4">
        <Button onClick={save} disabled={saving || loading}>
          {saving ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>) : "Salvar Analista IA"}
        </Button>
      </div>
    </motion.div>
  );
};
