import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { KommoSection } from "@/components/integrations/KommoSection";
import { supabase } from "@/integrations/supabase/client";
import { FieldOption, KommoCustomField, KommoPipelineStage, KommoSync } from "@/components/integrations/types";
import { AI_COPILOT } from "@/lib/features";

/** Chama kommo-manage e devolve o JSON cru (envelope no nível de cima). */
async function callKommo(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke<any>("kommo-manage", { body });
  if (error) throw new Error(error.message || "Falha ao chamar kommo-manage");
  if (!data) throw new Error("kommo-manage não retornou resposta");
  if (!data.success) throw new Error(data.error || "Erro desconhecido");
  return data;
}

const Integrations = () => {
  const [connected, setConnected] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [sync, setSync] = useState<KommoSync | null>(null);
  const [loading, setLoading] = useState(false);
  const [subdomain, setSubdomain] = useState("");
  const [token, setToken] = useState("");
  const [fields, setFields] = useState<KommoCustomField[]>([]);
  const [stages, setStages] = useState<KommoPipelineStage[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [loadingStages, setLoadingStages] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(
    "Você é um assistente de CRM. Ao analisar conversas, leve em conta os campos personalizados e etapas do funil mapeados abaixo para gerar sugestões precisas.",
  );
  const { toast } = useToast();
  const { activeWorkspace } = useWorkspace();

  const resetState = useCallback(() => {
    setConnected(false);
    setAccountName("");
    setSync(null);
    setFields([]);
    setStages([]);
  }, []);

  const callKommoWs = useCallback(
    (action: string, extra?: Record<string, unknown>) =>
      callKommo({ action, workspace_id: activeWorkspace?.id, ...extra }),
    [activeWorkspace],
  );

  const fetchFieldsAndStages = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoadingFields(true);
    setLoadingStages(true);
    setFields([]);
    setStages([]);

    let savedFields: any[] = [];
    let savedStages: any[] = [];
    let savedPrompt = "";
    try {
      const mappings = await callKommoWs("get_mappings");
      savedFields = mappings?.data?.selectedFields || [];
      savedStages = mappings?.data?.selectedStages || [];
      savedPrompt = mappings?.data?.aiPrompt || "";
      if (savedPrompt) setAiPrompt(savedPrompt);
    } catch {
      /* ignore */
    }

    try {
      const res = await callKommoWs("custom_fields");
      const customFields: KommoCustomField[] = (res?.data?.customFields || []).map((f: any) => {
        const saved = savedFields.find((sf: any) => sf.id === f.id);
        let mergedOptions: FieldOption[] | undefined = f.options;
        if (f.options && saved?.options) {
          mergedOptions = f.options.map((opt: FieldOption) => {
            const savedOpt = saved.options?.find((so: any) => (typeof so === "string" ? so : so.value) === opt.value);
            return savedOpt && typeof savedOpt === "object"
              ? { ...opt, instruction: savedOpt.instruction || "" }
              : opt;
          });
        }
        return {
          id: f.id,
          name: f.name,
          fieldKey: f.fieldKey,
          dataType: f.dataType || "text",
          selected: !!saved,
          description: saved?.description || "",
          options: mergedOptions,
        };
      });
      setFields(customFields);
    } catch (error) {
      console.error("Error fetching Kommo fields:", error);
      setFields([]);
    } finally {
      setLoadingFields(false);
    }

    try {
      const res = await callKommoWs("pipelines");
      const flat: KommoPipelineStage[] = [];
      for (const pipeline of res?.data?.pipelines || []) {
        for (const stage of pipeline.stages || []) {
          const saved = savedStages.find((ss: any) => ss.id === stage.id);
          flat.push({
            id: stage.id,
            name: stage.name,
            pipelineId: pipeline.id,
            pipelineName: pipeline.name,
            selected: !!saved,
            description: saved?.description || "",
          });
        }
      }
      setStages(flat);
    } catch (error) {
      console.error("Error fetching Kommo pipelines:", error);
      setStages([]);
    } finally {
      setLoadingStages(false);
    }
  }, [activeWorkspace, callKommoWs]);

  // Check connection status on mount / workspace change
  useEffect(() => {
    if (!activeWorkspace) return;
    const checkStatus = async () => {
      try {
        const data = await callKommoWs("status");
        if (data?.connected) {
          setConnected(true);
          setAccountName(data.subdomain || "");
          setSync(data.sync || null);
        } else {
          resetState();
        }
      } catch {
        /* silent */
      }
    };
    checkStatus();
  }, [activeWorkspace, callKommoWs, resetState]);

  useEffect(() => {
    if (connected && AI_COPILOT) fetchFieldsAndStages();
  }, [connected, fetchFieldsAndStages]);

  const toggleField = (id: string) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)));
  };

  const updateFieldDescription = (id: string, description: string) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, description } : f)));
  };

  const updateOptionInstruction = (fieldId: string, optionValue: string, instruction: string) => {
    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== fieldId || !f.options) return f;
        return {
          ...f,
          options: f.options.map((opt) => (opt.value === optionValue ? { ...opt, instruction } : opt)),
        };
      }),
    );
  };

  const toggleStage = (id: string) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)));
  };

  const updateStageDescription = (id: string, description: string) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, description } : s)));
  };

  const handleSaveMappings = async () => {
    const selectedFields = fields
      .filter((f) => f.selected)
      .map((f) => ({
        id: f.id,
        fieldKey: f.fieldKey,
        name: f.name,
        dataType: f.dataType,
        description: f.description,
        options: f.options || undefined,
      }));
    const selectedStages = stages
      .filter((s) => s.selected)
      .map((s) => ({
        id: s.id,
        name: s.name,
        pipelineId: s.pipelineId,
        pipelineName: s.pipelineName,
        description: s.description,
      }));
    try {
      await callKommoWs("save_mappings", { selectedFields, selectedStages, aiPrompt });
      toast({
        title: "Mapeamento salvo!",
        description: `${selectedFields.length} campos e ${selectedStages.length} etapas selecionados.`,
      });
    } catch (error) {
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleConnect = async () => {
    if (!subdomain || !token) {
      toast({ title: "Erro", description: "Preencha o subdomínio e o token.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const data = await callKommo({ action: "connect", subdomain, token, workspace_id: activeWorkspace?.id });
      setConnected(true);
      setAccountName(data.account?.name || subdomain);
      setToken("");
      toast({ title: "Kommo conectado!", description: `Conta: ${data.account?.name || subdomain}` });
    } catch (error) {
      resetState();
      toast({
        title: "Erro ao conectar",
        description: error instanceof Error ? error.message : "Verifique suas credenciais",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await callKommoWs("disconnect");
      resetState();
      toast({ title: "Kommo desconectado" });
    } catch (error) {
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro ao desconectar",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Integrações</h1>
        <p className="text-muted-foreground">Gerencie a conexão com o Kommo CRM</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <KommoSection
          connected={connected}
          accountName={accountName}
          sync={sync}
          loading={loading}
          subdomain={subdomain}
          token={token}
          setSubdomain={setSubdomain}
          setToken={setToken}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onReload={fetchFieldsAndStages}
          loadingFields={loadingFields}
          loadingStages={loadingStages}
          fields={fields}
          stages={stages}
          toggleField={toggleField}
          updateFieldDescription={updateFieldDescription}
          updateOptionInstruction={updateOptionInstruction}
          toggleStage={toggleStage}
          updateStageDescription={updateStageDescription}
          aiPrompt={aiPrompt}
          setAiPrompt={setAiPrompt}
          onSaveMappings={handleSaveMappings}
        />
      </motion.div>
    </div>
  );
};

export default Integrations;
