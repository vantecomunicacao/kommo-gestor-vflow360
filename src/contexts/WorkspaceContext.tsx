import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

// Sentinela pro "resolvido sem usuario" (user null), pra distinguir de "ainda
// nao resolvido pra ninguem" (estado inicial). Mesmo padrao do PermissionsContext.
const NO_USER = "__none__";

interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  deleted_at?: string | null;
  ai_analysis_enabled: boolean;
}

interface WorkspaceContextType {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  createWorkspace: (name: string) => Promise<Workspace>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  restoreWorkspace: (id: string) => Promise<void>;
  purgeWorkspace: (id: string) => Promise<void>;
  listTrashedWorkspaces: () => Promise<Workspace[]>;
  setWorkspaceAiEnabled: (id: string, enabled: boolean) => Promise<void>;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspaces: [],
  activeWorkspace: null,
  setActiveWorkspaceId: () => {},
  createWorkspace: async () => ({ id: "", name: "", owner_id: "", created_at: "", ai_analysis_enabled: false }),
  renameWorkspace: async () => {},
  deleteWorkspace: async () => {},
  restoreWorkspace: async () => {},
  purgeWorkspace: async () => {},
  listTrashedWorkspaces: async () => [],
  setWorkspaceAiEnabled: async () => {},
  loading: true,
});

export const useWorkspace = () => useContext(WorkspaceContext);

const ACTIVE_WS_KEY = "copiloto_active_workspace";

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Id do usuario para o qual `workspaces` reflete um resultado real (ou NO_USER).
  // `loading` eh DERIVADO por comparacao sincrona a cada render -- nao um state que
  // so atualiza dentro do efeito -- pra fechar a janela entre `user` mudar e o
  // efeito rodar (efeitos so rodam DEPOIS do commit). Nesse intervalo o valor
  // antigo de um `loading` de state ainda seria `false`, e a tela do Dashboard
  // mostraria "Selecione uma conta" por um instante mesmo com a busca a caminho.
  const [resolvedFor, setResolvedFor] = useState<string>(NO_USER);
  const loading = authLoading || resolvedFor !== (user?.id ?? NO_USER);

  useEffect(() => {
    let active = true;
    // Enquanto a sessao ainda esta sendo restaurada (reload), nao mexe em nada --
    // `loading` acima ja cobre esse caso via `authLoading`.
    if (authLoading) return;
    if (!user) {
      setWorkspaces([]);
      setActiveId(null);
      setResolvedFor(NO_USER);
      return;
    }

    // A busca de workspaces pode falhar (erro de rede/RLS) se disparar antes do
    // token de auth estar totalmente assentado no cliente (aba acordando de
    // segundo plano, sessao restaurada precisando de refresh, rede lenta na
    // abertura). Sem retry, `workspaces` ficava `[]` de forma DEFINITIVA -- o
    // seletor de contas aparecia vazio e o Dashboard travava em "Selecione uma
    // conta" ate um F5. Mesmo padrao do PermissionsContext (ver CLAUDE.md 2026-08-14).
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 500;

    const fetchWorkspaces = async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { data, error } = await supabase
          .from("workspaces")
          .select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: true });
        if (!active) return;

        if (!error && data) {
          const ws = data as Workspace[];
          setWorkspaces(ws);
          // Restore or set default active workspace
          const savedId = localStorage.getItem(ACTIVE_WS_KEY);
          if (savedId && ws.find(w => w.id === savedId)) {
            setActiveId(savedId);
          } else if (ws.length > 0) {
            setActiveId(ws[0].id);
            localStorage.setItem(ACTIVE_WS_KEY, ws[0].id);
          }
          setResolvedFor(user.id);
          return;
        }

        if (attempt < MAX_ATTEMPTS) {
          console.warn(
            `[WorkspaceContext] busca de workspaces falhou (tentativa ${attempt}/${MAX_ATTEMPTS}), tentando de novo`,
            error
          );
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
          if (!active) return;
        } else {
          console.error(
            "[WorkspaceContext] busca de workspaces falhou apos todas as tentativas",
            error
          );
        }
      }
      if (!active) return;
      // Esgotou as tentativas: marca como resolvido (para de mostrar skeleton) --
      // cai no estado "sem conta selecionada", que ao menos oferece o botao de
      // recarregar em vez de um spinner infinito.
      setResolvedFor(user.id);
    };

    fetchWorkspaces();
    return () => { active = false; };
  }, [user, authLoading]);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_WS_KEY, id);
  }, []);

  const createWorkspace = useCallback(async (name: string): Promise<Workspace> => {
    if (!user) throw new Error("Not authenticated");

    const { data: workspaceId, error: rpcError } = await supabase
      .rpc("create_workspace", { _name: name });

    if (rpcError) throw rpcError;

    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", workspaceId)
      .single();

    if (error) throw error;

    const ws = data as Workspace;
    setWorkspaces(prev => [...prev, ws]);
    setActiveWorkspaceId(ws.id);
    return ws;
  }, [user, setActiveWorkspaceId]);

  const renameWorkspace = useCallback(async (id: string, name: string) => {
    const { error } = await supabase
      .from("workspaces")
      .update({ name })
      .eq("id", id);
    if (error) throw error;
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name } : w));
  }, []);

  const deleteWorkspace = useCallback(async (id: string) => {
    if (workspaces.length <= 1) throw new Error("Não é possível excluir o único workspace");
    // Soft delete: vai para a lixeira (expurgo automático em 30 dias via pg_cron).
    const { error } = await supabase
      .from("workspaces")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    setWorkspaces(prev => {
      const remaining = prev.filter(w => w.id !== id);
      if (activeId === id && remaining.length > 0) {
        setActiveWorkspaceId(remaining[0].id);
      }
      return remaining;
    });
  }, [workspaces.length, activeId, setActiveWorkspaceId]);

  const restoreWorkspace = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("workspaces")
      .update({ deleted_at: null })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    const ws = data as Workspace;
    setWorkspaces(prev =>
      prev.some(w => w.id === ws.id)
        ? prev
        : [...prev, ws].sort((a, b) => a.created_at.localeCompare(b.created_at))
    );
  }, []);

  const purgeWorkspace = useCallback(async (id: string) => {
    // Hard delete: remove definitivamente. FKs ON DELETE CASCADE limpam todos os
    // dados relacionados (integracoes, conversas, mensagens, sugestoes, etc.).
    // RLS so permite ao dono (auth.uid() = owner_id).
    const { error } = await supabase.from("workspaces").delete().eq("id", id);
    if (error) throw error;
  }, []);

  const listTrashedWorkspaces = useCallback(async (): Promise<Workspace[]> => {
    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw error;
    return (data || []) as Workspace[];
  }, []);

  const setWorkspaceAiEnabled = useCallback(async (id: string, enabled: boolean) => {
    const { error } = await supabase
      .from("workspaces")
      .update({ ai_analysis_enabled: enabled })
      .eq("id", id);
    if (error) throw error;
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, ai_analysis_enabled: enabled } : w));
  }, []);

  const activeWorkspace = useMemo(
    () => workspaces.find(w => w.id === activeId) || null,
    [workspaces, activeId]
  );

  const contextValue = useMemo(
    () => ({
      workspaces,
      activeWorkspace,
      setActiveWorkspaceId,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      restoreWorkspace,
      purgeWorkspace,
      listTrashedWorkspaces,
      setWorkspaceAiEnabled,
      loading,
    }),
    [
      workspaces,
      activeWorkspace,
      loading,
      setActiveWorkspaceId,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      restoreWorkspace,
      purgeWorkspace,
      listTrashedWorkspaces,
      setWorkspaceAiEnabled,
    ]
  );

  return (
    <WorkspaceContext.Provider value={contextValue}>
      {children}
    </WorkspaceContext.Provider>
  );
};
