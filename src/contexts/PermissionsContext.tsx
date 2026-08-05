import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export interface Permissions {
  viewSuggestions: boolean;
  viewIntegrations: boolean;
  viewSettings: boolean;
  isAdmin: boolean;
}

const DEFAULT: Permissions = {
  viewSuggestions: false,
  viewIntegrations: false,
  viewSettings: false,
  isAdmin: false,
};

interface PermissionsContextType {
  permissions: Permissions;
  loading: boolean;
}

const PermissionsContext = createContext<PermissionsContextType>({
  permissions: DEFAULT,
  loading: true,
});

export const usePermissions = () => useContext(PermissionsContext);

// Usuario "so sugestoes" (vendedor): nao-admin, ve sugestoes e nada mais.
export function isSuggestionsOnly(p: Permissions): boolean {
  return !p.isAdmin && p.viewSuggestions && !p.viewIntegrations && !p.viewSettings;
}

// Rota de destino conforme o perfil. Fase 1 (produto de analytics): Sugestoes saiu
// do produto, entao o perfil "so sugestoes" cai em /leads-esfriando (unica pagina que
// ele enxerga). Demais -> Dashboard. Ver docs/ROADMAP_FASE2_COPILOTO.md.
export function landingPath(p: Permissions): string {
  return isSuggestionsOnly(p) ? "/leads-esfriando" : "/dashboard";
}

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // Enquanto a sessao ainda esta sendo restaurada (reload), mantemos loading=true
    // para os guards nao avaliarem permissoes DEFAULT no intervalo user=null->presente
    // (senao um F5 em rota protegida chutaria o usuario para /dashboard).
    if (authLoading) {
      setLoading(true);
      return;
    }
    if (!user) {
      setPermissions(DEFAULT);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.rpc("get_my_permissions").then(({ data, error }) => {
      if (!active) return;
      if (error || !data || !data[0]) {
        setPermissions(DEFAULT);
      } else {
        const r = data[0];
        setPermissions({
          viewSuggestions: !!r.view_suggestions,
          viewIntegrations: !!r.view_integrations,
          viewSettings: !!r.view_settings,
          isAdmin: !!r.is_admin,
        });
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user, authLoading]);

  const value = useMemo(() => ({ permissions, loading }), [permissions, loading]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
};
