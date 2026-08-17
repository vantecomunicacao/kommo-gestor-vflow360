// Dados e identidades de teste para os E2E.
// Nada aqui toca o Supabase real — é tudo devolvido pelos mocks de rede.

export type Role = "gestor" | "vendedor";

const now = () => new Date().toISOString();
const epochIn = (secs: number) => Math.floor(Date.now() / 1000) + secs;

// ---------------------------------------------------------------------------
// Identidade / sessão (formato GoTrue, o que o supabase-js espera)
// ---------------------------------------------------------------------------

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// JWT "de mentira" mas estruturalmente válido, para o supabase-js conseguir
// decodificar exp/sub sem erro.
function fakeJwt(sub: string): string {
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub,
    aud: "authenticated",
    role: "authenticated",
    exp: epochIn(3600),
    iat: Math.floor(Date.now() / 1000),
  });
  return `${header}.${payload}.e2e-signature`;
}

export function userFor(role: Role) {
  const id = role === "gestor" ? "user-gestor-0001" : "user-vendedor-0001";
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${role}@vflow360.test`,
    email_confirmed_at: now(),
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: role === "gestor" ? "Gestor Teste" : "Vendedor Teste" },
    identities: [],
    created_at: now(),
    updated_at: now(),
  };
}

export function sessionFor(role: Role) {
  const user = userFor(role);
  return {
    access_token: fakeJwt(user.id),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: epochIn(3600),
    refresh_token: `e2e-refresh-${role}`,
    user,
  };
}

// ---------------------------------------------------------------------------
// Permissões (retorno do RPC get_my_permissions)
//   gestor   -> vê tudo + admin
//   vendedor -> só Leads esfriando (view_cooling true, resto false)
// ---------------------------------------------------------------------------

export function permissionsFor(role: Role) {
  if (role === "gestor") {
    return {
      view_cooling: true,
      view_dashboard: true,
      view_integrations: true,
      view_settings: true,
      is_admin: true,
    };
  }
  return {
    view_cooling: true,
    view_dashboard: false,
    view_integrations: false,
    view_settings: false,
    is_admin: false,
  };
}

// ---------------------------------------------------------------------------
// Dados de tabelas (PostgREST / .from())
// ---------------------------------------------------------------------------

export const WORKSPACE_ID = "ws-e2e-0001";

export const workspaces = [
  {
    id: WORKSPACE_ID,
    name: "Workspace E2E",
    owner_id: "user-gestor-0001",
    created_at: now(),
    deleted_at: null,
    ai_analysis_enabled: true,
  },
];

export const suggestions = [
  {
    id: "sg-0001",
    type: "mover_funil",
    title: "Mover João para 'Negociação'",
    description: "Cliente demonstrou interesse claro em fechar.",
    status: "pending",
    action_data: {
      contact_name: "João Cliente",
      contact_phone: "+5511999990001",
      ghl_pipeline_name: "Vendas",
      ghl_stage_name: "Negociação",
    },
    created_at: now(),
    conversation_id: "cv-0001",
    ai_provider: "openai",
    conversations: { integration_label: "WhatsApp Comercial" },
  },
  {
    id: "sg-0002",
    type: "adicionar_nota",
    title: "Adicionar nota para Maria",
    description: "Registrar que prefere contato à tarde.",
    status: "pending",
    action_data: {
      contact_name: "Maria Lead",
      contact_phone: "+5511999990002",
    },
    created_at: now(),
    conversation_id: "cv-0002",
    ai_provider: "openai",
    conversations: { integration_label: "WhatsApp Comercial" },
  },
];

export const ghl_conversations = [
  {
    id: "cv-0001",
    ghl_conversation_id: "ghlcv-0001",
    contact_name: "João Cliente",
    contact_phone: "+5511999990001",
    contact_email: "joao@cliente.test",
    profile_photo_url: null,
    channel_type: "whatsapp",
    last_message_at: now(),
    last_message_body: "Quero fechar o plano anual.",
    last_message_direction: "inbound",
    unread_count: 2,
    assigned_ghl_user_id: "ghlu-1",
    workspace_id: WORKSPACE_ID,
  },
];

export const ghl_users = [
  { ghl_id: "ghlu-1", name: "Vendedor Teste", workspace_id: WORKSPACE_ID },
];

export const integrations = [
  {
    id: "int-0001",
    workspace_id: WORKSPACE_ID,
    provider: "evolution",
    label: "WhatsApp Comercial",
    status: "connected",
    instance_name: "comercial",
    created_at: now(),
  },
];

// Mapa tabela -> linhas. Tabelas não listadas devolvem [].
export function tableRows(table: string): unknown[] {
  switch (table) {
    case "workspaces":
      return workspaces;
    case "suggestions":
      return suggestions;
    case "conversations":
    case "ghl_conversations":
      return ghl_conversations;
    case "ghl_users":
      return ghl_users;
    case "integrations":
      return integrations;
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// RPCs (.rpc())
// ---------------------------------------------------------------------------

export function rpcResult(fn: string, role: Role): unknown {
  switch (fn) {
    case "get_my_permissions":
      return [permissionsFor(role)];
    case "create_workspace":
      return "ws-e2e-novo";
    case "list_workspace_members":
      return [];
    case "add_workspace_member":
    case "remove_workspace_member":
      return null;
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Edge functions (functions.invoke / fetch direto)
// ---------------------------------------------------------------------------

export function edgeResult(fn: string): unknown {
  switch (fn) {
    case "evolution-pairing-public":
      // 1x1 PNG transparente como QR de teste
      return {
        ok: true,
        status: "qr",
        qrcode:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        label: "WhatsApp Comercial",
      };
    case "ghl-dashboard":
      return { ok: true, metrics: {}, series: [] };
    default:
      return { ok: true };
  }
}
