// @ts-nocheck — "futuramente": depende de tabelas/funcs do schema antigo (public/GHL) ainda não migradas para kommo. Página não priorizada nesta fase.
import { useState, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Filter, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSuggestions, useAiConfig, useDisabledContacts } from "@/hooks/use-suggestions";
import { AiConfigPopover } from "@/components/suggestions/AiConfigPopover";
import { ContactGroupCard } from "@/components/suggestions/ContactGroupCard";
import {
  suggestionTypeOptions,
  type ContactGroup,
  type CreationConfig,
  type ExecutionResult,
  type LostReason,
  type Suggestion,
  type SuggestionStatus,
} from "@/components/suggestions/types";

// Converte o channel_type do GHL (ex: "TYPE_WHATSAPP") num rótulo amigável.
function formatChannelType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toUpperCase().replace(/^TYPE_/, "");
  const labels: Record<string, string> = {
    WHATSAPP: "WhatsApp",
    SMS: "SMS",
    EMAIL: "E-mail",
    CUSTOM_EMAIL: "E-mail",
    IG: "Instagram",
    INSTAGRAM: "Instagram",
    FB: "Facebook",
    FACEBOOK: "Facebook",
    GMB: "Google",
    PHONE: "Telefone",
    CALL: "Telefone",
    LIVE_CHAT: "Chat",
    WEBCHAT: "Chat",
  };
  return labels[key] || key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ");
}

const Suggestions = () => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [filter, setFilter] = useState<SuggestionStatus | "all">("all");
  const [aiConfig, setAiConfig] = useState<Record<string, { enabled: boolean; autoApprove: boolean }>>({});
  const [openContacts, setOpenContacts] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [disabledContacts, setDisabledContacts] = useState<Set<string>>(new Set());
  const [creationConfig, setCreationConfig] = useState<CreationConfig>({ allowCreateContact: true, allowCreateOpportunity: true });
  const [savingCreationConfig, setSavingCreationConfig] = useState(false);
  const [lostReasons, setLostReasons] = useState<LostReason[]>([]);
  const [selectedLostReasons, setSelectedLostReasons] = useState<Record<string, string>>({});
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executionResults, setExecutionResults] = useState<Record<string, ExecutionResult>>({});
  const [rejectingContact, setRejectingContact] = useState<string | null>(null);
  const [approvingContact, setApprovingContact] = useState<string | null>(null);
  const [approveProgress, setApproveProgress] = useState<{ current: number; total: number } | null>(null);
  const [confirmApproveGroup, setConfirmApproveGroup] = useState<ContactGroup | null>(null);
  const { toast } = useToast();
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();

  const { data: suggestionsData, isLoading: loading, refetch: refetchSuggestions } = useSuggestions();
  const { data: aiConfigData } = useAiConfig();
  const { data: disabledContactsData } = useDisabledContacts();

  useEffect(() => {
    if (suggestionsData) setSuggestions(suggestionsData as unknown as Suggestion[]);
  }, [suggestionsData]);

  useEffect(() => {
    if (aiConfigData) setAiConfig(aiConfigData);
  }, [aiConfigData]);

  useEffect(() => {
    if (disabledContactsData) setDisabledContacts(disabledContactsData);
  }, [disabledContactsData]);

  useEffect(() => {
    if (!activeWorkspace) return;
    const fetchCreationConfig = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("ghl-manage", {
          body: { action: "get_creation_config", workspace_id: activeWorkspace.id },
        });
        if (!error && data?.success) {
          setCreationConfig(data.data);
        }
      } catch {}
    };
    const fetchLostReasons = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("ghl-manage", {
          body: { action: "lost_reasons", workspace_id: activeWorkspace.id },
        });
        if (!error && data?.success && Array.isArray(data.data)) {
          setLostReasons(data.data);
        }
      } catch {}
    };
    fetchCreationConfig();
    fetchLostReasons();
  }, [activeWorkspace]);

  // Pre-fill selectedLostReasons from AI-suggested lostReasonId in action_data
  useEffect(() => {
    if (!suggestionsData) return;
    const prefilled: Record<string, string> = {};
    for (const s of suggestionsData) {
      const ad = s.action_data as Record<string, any> | null;
      if (s.type === "ganho_perdido" && s.status === "pending" && ad?.lostReasonId) {
        prefilled[s.id] = ad.lostReasonId;
      }
    }
    if (Object.keys(prefilled).length > 0) {
      setSelectedLostReasons(prev => ({ ...prefilled, ...prev }));
    }
  }, [suggestionsData]);

  const saveCreationConfig = async (newConfig: CreationConfig) => {
    setSavingCreationConfig(true);
    try {
      await supabase.functions.invoke("ghl-manage", {
        body: { action: "save_creation_config", workspace_id: activeWorkspace?.id, ...newConfig },
      });
      setCreationConfig(newConfig);
      toast({ title: "Configuração salva", description: "Preferências de criação atualizadas." });
    } catch {
      toast({ title: "Erro", description: "Não foi possível salvar.", variant: "destructive" });
    } finally {
      setSavingCreationConfig(false);
    }
  };

  const fetchSuggestions = useCallback(() => {
    refetchSuggestions();
  }, [refetchSuggestions]);

  const toggleContactAI = async (phone: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!phone || !activeWorkspace) return;
    const isDisabled = disabledContacts.has(phone);
    try {
      if (isDisabled) {
        await supabase
          .from("disabled_contacts")
          .delete()
          .eq("contact_phone", phone)
          .eq("workspace_id", activeWorkspace.id);
        setDisabledContacts(prev => { const next = new Set(prev); next.delete(phone); return next; });
        toast({ title: "IA ativada", description: "A IA voltará a analisar este contato." });
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from("disabled_contacts").insert({
          user_id: user.id,
          contact_phone: phone,
          workspace_id: activeWorkspace.id,
        });
        setDisabledContacts(prev => new Set(prev).add(phone));
        toast({ title: "IA desativada", description: "A IA não analisará mais este contato." });
      }
      queryClient.invalidateQueries({ queryKey: ["disabled_contacts", activeWorkspace.id] });
    } catch {
      toast({ title: "Erro", description: "Não foi possível alterar a configuração.", variant: "destructive" });
    }
  };

  const saveConfigItem = async (actionType: string, config: { enabled: boolean; autoApprove: boolean }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !activeWorkspace) return;

      const { data: existing } = await supabase
        .from("ai_config")
        .select("id")
        .eq("user_id", user.id)
        .eq("action_type", actionType)
        .eq("workspace_id", activeWorkspace.id)
        .maybeSingle();

      if (existing) {
        await supabase.from("ai_config")
          .update({ enabled: config.enabled, auto_approve: config.autoApprove })
          .eq("id", existing.id);
      } else {
        await supabase.from("ai_config")
          .insert({
            user_id: user.id,
            action_type: actionType,
            enabled: config.enabled,
            auto_approve: config.autoApprove,
            workspace_id: activeWorkspace.id,
          });
      }
    } catch (error) {
      console.error("Error saving ai config:", error);
    }
  };

  const toggleEnabled = async (key: string) => {
    const newConfig = { ...aiConfig, [key]: { ...aiConfig[key], enabled: !aiConfig[key]?.enabled } };
    setAiConfig(newConfig);
    await saveConfigItem(key, newConfig[key]);
  };

  const toggleAutoApprove = async (key: string) => {
    const newConfig = { ...aiConfig, [key]: { ...aiConfig[key], autoApprove: !aiConfig[key]?.autoApprove } };
    setAiConfig(newConfig);
    await saveConfigItem(key, newConfig[key]);
  };

  const handleAction = async (id: string, action: "approved" | "rejected") => {
    if (action === "approved") {
      const suggestion = suggestions.find(s => s.id === id);
      const isLost = suggestion?.type === "ganho_perdido" && !(suggestion?.action_data?.value || "").toLowerCase().includes("ganh");
      const lostReasonId = isLost ? selectedLostReasons[id] : undefined;

      if (isLost && lostReasons.length > 0 && !lostReasonId) {
        toast({ title: "Motivo de perda obrigatório", description: "Selecione o motivo de perda antes de aprovar.", variant: "destructive" });
        return;
      }

      setExecutingId(id);
      try {
        const body: Record<string, any> = { action: "execute_suggestion", suggestionId: id, workspace_id: activeWorkspace?.id };
        if (lostReasonId) body.lostReasonId = lostReasonId;

        const { data: result, error: fnError } = await supabase.functions.invoke("ghl-manage", { body });

        if (fnError || !result?.success) {
          const errorMsg = result?.error || fnError?.message || "Erro ao executar a sugestão no CRM.";
          toast({ title: "Erro ao executar", description: errorMsg, variant: "destructive" });
          return;
        }

        setSuggestions(prev => prev.map(s => s.id === id ? { ...s, status: "approved" as SuggestionStatus } : s));
        setExecutionResults(prev => ({
          ...prev,
          [id]: {
            opportunityCreated: result.data?.opportunityCreated ?? false,
            contactCreated: result.data?.contactCreated ?? false,
            message: result.data?.message || "Ação aplicada com sucesso.",
          },
        }));
        toast({
          title: "✅ Sugestão executada!",
          description: result.data?.message || "Ação aplicada com sucesso no CRM.",
        });
      } catch (error) {
        toast({ title: "Erro", description: "Falha ao conectar com o CRM.", variant: "destructive" });
      } finally {
        setExecutingId(null);
      }
    } else {
      try {
        const { error } = await supabase
          .from("suggestions")
          .update({ status: action })
          .eq("id", id);
        if (error) throw error;
        setSuggestions(prev => prev.map(s => s.id === id ? { ...s, status: action } : s));
        toast({ title: "Sugestão rejeitada", description: "A sugestão foi descartada." });
      } catch {
        toast({ title: "Erro", description: "Não foi possível atualizar a sugestão.", variant: "destructive" });
      }
    }
  };

  const filtered = useMemo(() => {
    let result = filter === "all" ? suggestions : suggestions.filter(s => s.status === filter);
    if (typeFilter !== "all") {
      result = result.filter(s => s.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(s => {
        const name = (s.action_data?.contact_name || "").toLowerCase();
        const phone = (s.action_data?.contact_phone || "").toLowerCase();
        return name.includes(q) || phone.includes(q);
      });
    }
    return result;
  }, [suggestions, filter, typeFilter, searchQuery]);

  const pendingCount = suggestions.filter(s => s.status === "pending").length;

  const contactGroups: ContactGroup[] = useMemo(() => {
    const groups = new Map<string, ContactGroup>();

    for (const s of filtered) {
      const name = s.action_data?.contact_name || "Contato desconhecido";
      const phone = s.action_data?.contact_phone || "";
      const key = `${phone || name}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          contactName: name,
          contactPhone: phone,
          suggestions: [],
          pendingCount: 0,
          integrationLabel: null,
          createdAt: null,
          lastApprovedAt: null,
          lastAssignedTo: null,
          actionSummary: [],
        });
      }

      const group = groups.get(key)!;
      group.suggestions.push(s);
      if (s.status === "pending") group.pendingCount++;
    }

    for (const group of groups.values()) {
      const withLabel = group.suggestions.find(s => s.ghl_conversations?.channel_type);
      if (withLabel) group.integrationLabel = formatChannelType(withLabel.ghl_conversations!.channel_type);

      const approved = group.suggestions
        .filter(s => s.status === "approved")
        .sort((a, b) => (b.action_data?.executed_at || b.created_at).localeCompare(a.action_data?.executed_at || a.created_at));
      if (approved.length > 0) {
        group.lastApprovedAt = approved[0].action_data?.executed_at || approved[0].created_at;
        group.lastAssignedTo = approved[0].action_data?.ghl_assigned_to || null;
      }

      group.createdAt = group.suggestions.reduce<string | null>(
        (latest, s) => (!latest || s.created_at > latest ? s.created_at : latest),
        null,
      );

      const typeCounts = new Map<string, number>();
      for (const s of group.suggestions) {
        typeCounts.set(s.type, (typeCounts.get(s.type) || 0) + 1);
      }
      group.actionSummary = Array.from(typeCounts.entries()).map(([type, count]) => ({ type, count }));
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
      if (b.pendingCount > 0 && a.pendingCount === 0) return 1;
      const aLatest = a.suggestions[0]?.created_at || "";
      const bLatest = b.suggestions[0]?.created_at || "";
      return bLatest.localeCompare(aLatest);
    });
  }, [filtered]);

  const toggleContact = (key: string) => {
    setOpenContacts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRejectAllByContact = async (group: ContactGroup) => {
    const pendingIds = group.suggestions.filter(s => s.status === "pending").map(s => s.id);
    if (pendingIds.length === 0) return;
    setRejectingContact(group.key);
    try {
      const { error } = await supabase
        .from("suggestions")
        .update({ status: "rejected" })
        .in("id", pendingIds);
      if (error) throw error;
      setSuggestions(prev => prev.map(s => pendingIds.includes(s.id) ? { ...s, status: "rejected" as SuggestionStatus } : s));
      toast({ title: "Sugestões rejeitadas", description: `${pendingIds.length} sugestão(ões) de ${group.contactName} foram rejeitadas.` });
    } catch {
      toast({ title: "Erro", description: "Não foi possível rejeitar as sugestões.", variant: "destructive" });
    } finally {
      setRejectingContact(null);
    }
  };

  // Approve all pending suggestions for a contact, one at a time, bottom-up.
  const handleApproveAllByContact = async (group: ContactGroup) => {
    const pending = group.suggestions.filter(s => s.status === "pending").slice().reverse();
    if (pending.length === 0) return;

    setApprovingContact(group.key);
    setApproveProgress({ current: 0, total: pending.length });

    let approvedCount = 0;
    const failures: { id: string; reason: string }[] = [];

    for (let i = 0; i < pending.length; i++) {
      const s = pending[i];
      setApproveProgress({ current: i + 1, total: pending.length });

      const isLost = s.type === "ganho_perdido" && !(s.action_data?.value || "").toLowerCase().includes("ganh");
      const lostReasonId = isLost ? selectedLostReasons[s.id] : undefined;
      if (isLost && lostReasons.length > 0 && !lostReasonId) {
        failures.push({ id: s.id, reason: "Motivo de perda não selecionado" });
        continue;
      }

      try {
        const body: Record<string, any> = { action: "execute_suggestion", suggestionId: s.id, workspace_id: activeWorkspace?.id };
        if (lostReasonId) body.lostReasonId = lostReasonId;
        const { data: result, error: fnError } = await supabase.functions.invoke("ghl-manage", { body });

        if (fnError || !result?.success) {
          failures.push({ id: s.id, reason: result?.error || fnError?.message || "Erro no CRM" });
          continue;
        }

        approvedCount++;
        setSuggestions(prev => prev.map(x => x.id === s.id ? { ...x, status: "approved" as SuggestionStatus } : x));
        setExecutionResults(prev => ({
          ...prev,
          [s.id]: {
            opportunityCreated: result.data?.opportunityCreated ?? false,
            contactCreated: result.data?.contactCreated ?? false,
            message: result.data?.message || "Ação aplicada com sucesso.",
          },
        }));
      } catch (e) {
        failures.push({ id: s.id, reason: e instanceof Error ? e.message : "Falha de conexão" });
      }
    }

    setApprovingContact(null);
    setApproveProgress(null);

    if (failures.length === 0) {
      toast({ title: "✅ Todas executadas", description: `${approvedCount} sugestão(ões) de ${group.contactName} foram aceitas.` });
    } else {
      toast({
        title: `Concluído com ${failures.length} falha(s)`,
        description: `${approvedCount} aceita(s), ${failures.length} falharam. As que falharam continuam pendentes.`,
        variant: failures.length === pending.length ? "destructive" : "default",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Sugestões da IA
          </h1>
          <p className="text-muted-foreground">{pendingCount} sugestões pendentes de revisão</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchSuggestions} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <AiConfigPopover
            aiConfig={aiConfig}
            creationConfig={creationConfig}
            savingCreationConfig={savingCreationConfig}
            onToggleEnabled={toggleEnabled}
            onToggleAutoApprove={toggleAutoApprove}
            onSaveCreationConfig={saveCreationConfig}
          />
          <Filter className="w-4 h-4 text-muted-foreground" />
          {(["all", "pending", "approved", "rejected"] as const).map(f => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Todas" : f === "pending" ? "Pendentes" : f === "approved" ? "Aprovadas" : "Rejeitadas"}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Tipo de sugestão" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {suggestionTypeOptions.map(opt => (
              <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : contactGroups.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Nenhuma sugestão encontrada</h3>
          <p className="text-sm text-muted-foreground">
            As sugestões aparecerão aqui quando a IA analisar suas conversas do WhatsApp.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {contactGroups.map((group) => (
            <ContactGroupCard
              key={group.key}
              group={group}
              isOpen={openContacts.has(group.key)}
              isContactDisabled={!!group.contactPhone && disabledContacts.has(group.contactPhone)}
              approvingThisGroup={approvingContact === group.key}
              rejectingThisGroup={rejectingContact === group.key}
              approveProgress={approvingContact === group.key ? approveProgress : null}
              anyExecuting={!!executingId}
              executingId={executingId}
              executionResults={executionResults}
              lostReasons={lostReasons}
              selectedLostReasons={selectedLostReasons}
              onToggleOpen={() => toggleContact(group.key)}
              onToggleContactAI={toggleContactAI}
              onRequestApproveAll={() => setConfirmApproveGroup(group)}
              onRejectAll={() => handleRejectAllByContact(group)}
              onSelectLostReason={(suggestionId, reasonId) =>
                setSelectedLostReasons(prev => ({ ...prev, [suggestionId]: reasonId }))
              }
              onApprove={(id) => handleAction(id, "approved")}
              onReject={(id) => handleAction(id, "rejected")}
            />
          ))}
        </div>
      )}

      <AlertDialog open={!!confirmApproveGroup} onOpenChange={(open) => !open && setConfirmApproveGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aceitar todas as sugestões?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmApproveGroup && (
                <>
                  Serão executadas <strong>{confirmApproveGroup.suggestions.filter(s => s.status === "pending").length}</strong> sugestão(ões) pendentes de <strong>{confirmApproveGroup.contactName}</strong>, uma por vez (de baixo para cima).
                  <br /><br />
                  Se alguma falhar no CRM, o lote continua e as que falharem permanecem pendentes para você revisar.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const g = confirmApproveGroup;
                setConfirmApproveGroup(null);
                if (g) handleApproveAllByContact(g);
              }}
            >
              Aceitar todas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Suggestions;
