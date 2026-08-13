import { Brain, Eye, EyeOff, ShieldCheck, History } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProviderStatus {
  hasKey: boolean;
  model: string | null;
}

interface AuditEntry {
  action: "created" | "updated" | "deleted";
  model: string | null;
  createdAt: string;
  userName: string | null;
}

const AUDIT_ACTION_LABEL: Record<AuditEntry["action"], string> = {
  created: "Chave configurada",
  updated: "Chave/modelo alterados",
  deleted: "Chave removida",
};

// Invoca a edge kommo-ai-analyze nos modos provider_* (gestão da chave). A chave
// em si vive cifrada no Vault — nunca volta pro browser depois de salva; a edge
// só devolve { hasKey, model }.
async function invokeProvider<T>(mode: string, workspaceId: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("kommo-ai-analyze", {
    body: { mode, workspace_id: workspaceId, ...extra },
  });
  if (error) {
    try {
      const body = await error.context?.clone().json();
      if (body?.error) throw new Error(body.error as string);
    } catch (e) { if (e instanceof Error && e.message && !/json/i.test(e.message)) throw e; }
    throw new Error(error.message);
  }
  const err = (data as { error?: string } | null)?.error;
  if (err) throw new Error(err);
  return (data as { data: T }).data;
}

const AiSettings = () => {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o");
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const refreshAudit = (workspaceId: string) => {
    invokeProvider<{ audit: AuditEntry[] }>("provider_audit", workspaceId)
      .then((r) => setAudit(r.audit))
      .catch(() => { /* histórico é informativo; falha aqui não deve travar a tela */ });
  };

  useEffect(() => {
    if (!activeWorkspace) return;
    let stale = false;
    setOpenaiApiKey("");
    setHasKey(false);
    setAudit([]);
    setLoadingStatus(true);
    invokeProvider<ProviderStatus>("provider_status", activeWorkspace.id)
      .then((status) => {
        if (stale) return; // workspace trocou de novo antes desta resposta chegar
        setHasKey(status.hasKey);
        if (status.model) setOpenaiModel(status.model);
      })
      .catch(() => { if (!stale) toast.error("Não consegui verificar a chave de IA deste workspace."); })
      .finally(() => { if (!stale) setLoadingStatus(false); });
    refreshAudit(activeWorkspace.id);
    return () => { stale = true; };
  }, [activeWorkspace]);

  const saveAiProvider = async () => {
    if (!user || !activeWorkspace) return;
    if (!hasKey && !openaiApiKey.trim()) {
      toast.error("Informe a chave da API da OpenAI");
      return;
    }
    setSavingAi(true);
    try {
      await invokeProvider<ProviderStatus>("provider_save", activeWorkspace.id, {
        apiKey: openaiApiKey.trim(), model: openaiModel,
      });
      setHasKey(true);
      setOpenaiApiKey(""); // nunca fica exibida depois de salva
      refreshAudit(activeWorkspace.id);
      toast.success("Configuração de IA salva com sucesso!");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Erro ao salvar configuração de IA: ${msg}`);
    } finally {
      setSavingAi(false);
    }
  };

  const removeAiProvider = async () => {
    if (!activeWorkspace) return;
    setSavingAi(true);
    try {
      await invokeProvider<ProviderStatus>("provider_delete", activeWorkspace.id);
      setOpenaiApiKey("");
      setHasKey(false);
      refreshAudit(activeWorkspace.id);
      toast.success("Chave removida. As análises de IA deste workspace ficam indisponíveis até uma nova chave ser configurada.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Erro ao remover chave: ${msg}`);
    } finally {
      setSavingAi(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Provedor de IA</h1>
        <p className="text-muted-foreground">Modelo usado nas análises e sugestões</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-primary" /> Provedor de IA
        </h3>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Cada workspace usa sua própria chave da OpenAI, compartilhada entre os
            membros deste workspace — não existe uma chave central do app. Sem uma
            chave configurada aqui, as Análises de IA do Dashboard ficam indisponíveis
            para {activeWorkspace?.name || "este workspace"}.
          </p>

          {hasKey && (
            <p className="flex items-center gap-1.5 rounded-md border border-emerald-400/40 bg-emerald-50/50 px-2.5 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              Uma chave já está configurada e cifrada para este workspace. Para trocar, informe uma nova chave abaixo.
            </p>
          )}

          <div className="space-y-2">
            <Label>Chave da API (OpenAI)</Label>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder={hasKey ? "sk-... (deixe em branco pra manter a atual)" : "sk-..."}
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                disabled={loadingStatus}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Obtenha em{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="text-primary underline">
                platform.openai.com/api-keys
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label>Modelo</Label>
            <Select value={openaiModel} onValueChange={setOpenaiModel} disabled={loadingStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button onClick={saveAiProvider} disabled={savingAi || loadingStatus}>
              {savingAi ? "Salvando..." : "Salvar configuração de IA"}
            </Button>
            {hasKey && (
              <Button type="button" variant="outline" onClick={removeAiProvider} disabled={savingAi || loadingStatus}>
                Remover chave
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AiSettings;
