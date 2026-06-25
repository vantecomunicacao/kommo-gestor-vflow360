// @ts-nocheck — "futuramente": depende de tabelas/funcs do schema antigo (public/GHL) ainda não migradas para kommo. Página não priorizada nesta fase.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export function useSuggestions() {
  const { activeWorkspace } = useWorkspace();

  return useQuery({
    queryKey: ["suggestions", activeWorkspace?.id],
    queryFn: async () => {
      if (!activeWorkspace) return [];
      const { data, error } = await supabase
        .from("suggestions")
        .select("*, ghl_conversations:ghl_conversation_id(channel_type)")
        .eq("workspace_id", activeWorkspace.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeWorkspace,
  });
}

export function useAiConfig() {
  const { activeWorkspace } = useWorkspace();

  return useQuery({
    queryKey: ["ai_config", activeWorkspace?.id],
    queryFn: async () => {
      if (!activeWorkspace) return null;
      const { data } = await supabase
        .from("ai_config")
        .select("action_type, enabled, auto_approve")
        .eq("workspace_id", activeWorkspace.id);

      const config: Record<string, { enabled: boolean; autoApprove: boolean }> = {
        mover_funil: { enabled: true, autoApprove: false },
        campo_personalizado: { enabled: true, autoApprove: false },
        adicionar_nota: { enabled: true, autoApprove: false },
        valor_negociacao: { enabled: true, autoApprove: false },
        agendar_lembrete: { enabled: true, autoApprove: false },
        marcar_ganho: { enabled: true, autoApprove: false },
        marcar_perdido: { enabled: true, autoApprove: false },
      };
      if (data) {
        for (const c of data) {
          config[c.action_type] = { enabled: c.enabled, autoApprove: c.auto_approve };
        }
      }
      return config;
    },
    enabled: !!activeWorkspace,
  });
}

export function useDisabledContacts() {
  const { activeWorkspace } = useWorkspace();

  return useQuery({
    queryKey: ["disabled_contacts", activeWorkspace?.id],
    queryFn: async () => {
      if (!activeWorkspace) return new Set<string>();
      const { data } = await supabase
        .from("disabled_contacts")
        .select("contact_phone")
        .eq("workspace_id", activeWorkspace.id);
      return new Set((data || []).map((d: any) => d.contact_phone));
    },
    enabled: !!activeWorkspace,
  });
}
