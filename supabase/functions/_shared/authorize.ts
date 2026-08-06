// Autorização compartilhada das edge functions do Kommo.
//
// Fecha a brecha do padrão antigo ("sem usuário no JWT = liberado"): agora um
// request só passa por UM de dois caminhos legítimos:
//
//   1. Usuário final  → JWT válido + membership no workspace.
//   2. Chamada interna → header `x-internal-secret` == env INTERNAL_FUNCTION_SECRET
//                        (usado pelos crons postgres->edge).
//
// Qualquer outra combinação (anon key sem usuário, token inválido, sem segredo)
// é rejeitada com `Forbidden`.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthResult {
  /** sub do usuário quando autenticado por JWT; null em chamada interna. */
  userId: string | null;
  /** Caminho pelo qual o request foi autorizado. */
  via: "user" | "internal";
}

/** Comparação de segredos em tempo (aprox.) constante — evita timing oracle simples. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface AuthorizeOpts {
  req: Request;
  /** Client com service_role (schema kommo) para checar membership via RPC. */
  db: SupabaseClient;
  supabaseUrl: string;
  anonKey: string;
  workspaceId: string;
}

/**
 * Autoriza o request para o workspace. Lança `Error("Forbidden")` /
 * `Error("Missing authorization")` quando não autorizado.
 */
export async function authorizeWorkspace(opts: AuthorizeOpts): Promise<AuthResult> {
  const { req, db, supabaseUrl, anonKey, workspaceId } = opts;

  // 1) Caminho interno: segredo compartilhado (crons). Só vale se o env estiver
  //    configurado — nunca autoriza por um segredo vazio.
  const internalSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";
  const providedSecret = req.headers.get("x-internal-secret") || "";
  if (internalSecret && providedSecret && safeEqual(providedSecret, internalSecret)) {
    return { userId: null, via: "internal" };
  }

  // 2) Caminho de usuário: exige JWT válido + membership.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Error("Missing authorization");
  const token = authHeader.replace("Bearer ", "");

  let userId: string | null = null;
  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claims } = await userClient.auth.getClaims(token);
    userId = claims?.claims?.sub ?? null;
  } catch {
    userId = null;
  }

  // Sem usuário resolvido e sem segredo interno válido → bloqueia (era a brecha).
  if (!userId) throw new Error("Forbidden");

  const { data: isMember } = await db.rpc("is_workspace_member", {
    _user_id: userId,
    _workspace_id: workspaceId,
  });
  if (!isMember) throw new Error("Forbidden");

  return { userId, via: "user" };
}

export interface CallerIdentity {
  userId: string | undefined;
  userEmail: string | undefined;
}

/**
 * Resolve quem está chamando (sub/email do JWT), SEM checar workspace.
 * getClaims primeiro (rápido), com fallback pra getUser (cobre formatos de
 * JWT que getClaims não decodifica). Uso: fluxos sem workspace ainda pra
 * checar membership (bootstrap de admin, criação de workspace nova) — quando
 * já existe um workspaceId, prefira `authorizeWorkspace` (cobre também o
 * caminho interno via `x-internal-secret`, que esta função não cobre).
 */
export async function resolveCallerIdentity(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<CallerIdentity> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return { userId: undefined, userEmail: undefined };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  let userId: string | undefined;
  let userEmail: string | undefined;
  try {
    const { data: claims } = await userClient.auth.getClaims(token);
    const c = (claims as { claims?: Record<string, unknown> } | null)?.claims
      ?? (claims as Record<string, unknown> | null);
    userId = c?.sub as string | undefined;
    userEmail = c?.email as string | undefined;
  } catch {
    // fallback abaixo
  }
  if (!userId) {
    const { data: u } = await userClient.auth.getUser(token);
    userId = u?.user?.id;
    userEmail = u?.user?.email ?? userEmail;
  }
  return { userId, userEmail };
}

/** Lança `Error("Forbidden: not a member of this workspace")` se `userId` não for membro. */
export async function requireWorkspaceMember(
  db: SupabaseClient,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const { data: isMember } = await db.rpc("is_workspace_member", {
    _user_id: userId,
    _workspace_id: workspaceId,
  });
  if (!isMember) throw new Error("Forbidden: not a member of this workspace");
}
