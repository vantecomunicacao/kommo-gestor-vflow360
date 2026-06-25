// @ts-nocheck — "futuramente": depende de tabelas/funcs do schema antigo (public/GHL) ainda não migradas para kommo. Página não priorizada nesta fase.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Filter, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/hooks/use-toast";

interface PipelineRow {
  ghl_id: string;
  name: string;
}

export const AiPipelineFilter = () => {
  const { activeWorkspace } = useWorkspace();
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeWorkspace) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: pipes }, { data: settings }] = await Promise.all([
        supabase
          .from("ghl_pipelines")
          .select("ghl_id, name")
          .eq("workspace_id", activeWorkspace.id)
          .order("name"),
        supabase
          .from("ghl_dashboard_settings")
          .select("ai_allowed_pipeline_ids")
          .eq("workspace_id", activeWorkspace.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setPipelines(pipes || []);
      setAllowed(new Set((settings?.ai_allowed_pipeline_ids as string[] | null) || []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace]);

  const toggle = (id: string) => {
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!activeWorkspace) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("ghl_dashboard_settings")
        .upsert(
          {
            workspace_id: activeWorkspace.id,
            ai_allowed_pipeline_ids: Array.from(allowed),
          },
          { onConflict: "workspace_id" },
        );
      if (error) throw error;
      toast({ title: "Filtro salvo", description: "A IA agora respeitará os funis selecionados." });
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
      transition={{ delay: 0.15 }}
      className="glass-card p-6"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Filter className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Funis onde a IA sugere ações</h3>
          <p className="text-sm text-muted-foreground">
            A IA só gerará sugestões (mover funil, nota, campo…) para conversas cujo lead esteja em um dos funis selecionados.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
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
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {allowed.size === 0
                  ? "Nenhum funil selecionado → analisará todas as conversas"
                  : `${allowed.size} de ${pipelines.length} funis ativos`}
              </Badge>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {pipelines.map((p) => (
                <label
                  key={p.ghl_id}
                  htmlFor={`ai-pipe-${p.ghl_id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <Checkbox
                    id={`ai-pipe-${p.ghl_id}`}
                    checked={allowed.has(p.ghl_id)}
                    onCheckedChange={() => toggle(p.ghl_id)}
                  />
                  <span className="text-sm text-foreground">{p.name}</span>
                </label>
              ))}
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...
                </>
              ) : (
                "Salvar filtro"
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Quando ativo: conversas sem oportunidade vinculada no CRM <strong>não</strong> serão analisadas.
              Deixe vazio para manter o comportamento padrão (analisar tudo).
            </p>
          </>
        )}
      </div>
    </motion.div>
  );
};
