import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export interface Permissions {
  viewCooling: boolean;
  viewDashboard: boolean;
  viewIntegrations: boolean;
  viewSettings: boolean;
  isAdmin: boolean;
}

const DEFAULT: Permissions = {
  viewCooling: false,
  viewDashboard: false,
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

// Rota de destino conforme as permissoes: primeira area liberada, nessa ordem
// de prioridade. Sem nenhuma flag marcada (nao-admin sem acesso a nada), cai
// numa tela de "sem acesso" em vez de redirecionar pra uma rota bloqueada.
export function landingPath(p: Permissions): string {
  if (p.isAdmin || p.viewDashboard) return "/dashboard";
  if (p.viewCooling) return "/leads-esfriando";
  if (p.viewIntegrations) return "/integrations";
  if (p.viewSettings) return "/settings";
  return "/sem-acesso";
}

// Sentinela pro "resolvido sem usuario" (user null), pra distinguir de
// "ainda nao resolvido pra ninguem" (estado inicial). Nao pode ser null
// porque null tambem eh o valor de user?.id quando nao ha usuario.
const NO_USER = "__none__";

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT);
  // Id do usuario para o qual `permissions` reflete o valor real (ou NO_USER).
  // Comparado contra `user?.id` a cada render (nao dentro do efeito) porque
  // o efeito so roda DEPOIS do commit -- entre o momento em que `user` muda
  // (ex.: login) e o efeito rodar, existe um render com `user` novo mas
  // `loading` ainda no valor antigo (false, de antes do login). Nesse render,
  // se algum consumidor (Login.tsx) decidisse uma rota com permissoes DEFAULT
  // achando que "carregou", ele fixaria a rota errada (ex.: /sem-acesso) antes
  // do fetch real terminar. Derivar `loading` por comparacao sincrona evita
  // esse intervalo, sem precisar esperar o efeito.
  const [resolvedFor, setResolvedFor] = useState<string>(NO_USER);
  const loading = authLoading || resolvedFor !== (user?.id ?? NO_USER);

  useEffect(() => {
    let active = true;
    // Enquanto a sessao ainda esta sendo restaurada (reload), nao mexe em nada
    // -- `loading` acima ja cobre esse caso via `authLoading`.
    if (authLoading) {
      return;
    }
    if (!user) {
      setPermissions(DEFAULT);
      setResolvedFor(NO_USER);
      return;
    }

    // get_my_permissions() pode falhar/retornar vazio se disparar antes do token
    // de auth estar totalmente assentado no cliente (aba acordando de segundo
    // plano, sessao restaurada precisando de refresh, rede lenta na abertura).
    // Sem retry aqui, o resultado errado (DEFAULT) ficava definitivo - o menu
    // perdia Configuracoes/Integracoes/Admin ate um F5 forcar tudo de novo, ja
    // que nada mais reexecuta esse efeito. Ver CLAUDE.md (2026-08-14).
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 500;

    const fetchPermissions = async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { data, error } = await supabase.rpc("get_my_permissions");
        if (!active) return;
        if (!error && data && data[0]) {
          const r = data[0];
          setPermissions({
            viewCooling: !!r.view_cooling,
            viewDashboard: !!r.view_dashboard,
            viewIntegrations: !!r.view_integrations,
            viewSettings: !!r.view_settings,
            isAdmin: !!r.is_admin,
          });
          setResolvedFor(user.id);
          return;
        }
        if (attempt < MAX_ATTEMPTS) {
          console.warn(
            `[PermissionsContext] get_my_permissions falhou (tentativa ${attempt}/${MAX_ATTEMPTS}), tentando de novo`,
            error
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
          if (!active) return;
        } else {
          console.error(
            "[PermissionsContext] get_my_permissions falhou apos todas as tentativas, usando permissoes padrao",
            error
          );
        }
      }
      if (!active) return;
      setPermissions(DEFAULT);
      setResolvedFor(user.id);
    };

    fetchPermissions();

    return () => {
      active = false;
    };
  }, [user, authLoading]);

  const value = useMemo(() => ({ permissions, loading }), [permissions, loading]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
};
