// VFlow360 Kommo — kommo-admin-users
// Gestão de usuários do sistema Kommo. Espelha admin-users, mas opera SOMENTE no
// schema `kommo` (não toca em public/GHL). auth.users é COMPARTILHADO com o GHL, então:
//   - create_user: se o e-mail já existe no auth, ANEXA ao Kommo (não recria/erra).
//   - delete_user: NUNCA apaga do auth — só remove a presença no kommo.* (revoga acesso).
//   - update_password: muda a senha da conta única (efeito também no GHL) — usar com ciência.
//   - list_users: escopado aos usuários com presença no kommo.*.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    let userId: string | undefined;
    try {
      const { data: claims } = await (userClient.auth as any).getClaims(token);
      userId = claims?.sub || claims?.claims?.sub;
    } catch (_) { /* fallback */ }
    if (!userId) {
      const { data: u } = await userClient.auth.getUser(token);
      userId = u?.user?.id;
    }
    if (!userId) return json({ error: "Unauthorized" }, 401);

    // auth: client de service só para a Admin API (auth.users compartilhado).
    const authAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);
    // db: client no schema kommo — todo .from() resolve em kommo.*
    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: "kommo" } });

    // Caller precisa ser admin NO KOMMO.
    const { data: roleRow } = await db.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    switch (action) {
      case "list_users": {
        // Escopo: só usuários com presença no kommo.* (não lista usuários só-GHL).
        const [{ data: kRoles }, { data: kPerms }, { data: kMembers }, { data: kProfiles }] = await Promise.all([
          db.from("user_roles").select("user_id, role"),
          db.from("user_permissions").select("user_id, view_suggestions, view_integrations, view_settings"),
          db.from("workspace_members").select("user_id, workspace_id, role, workspaces(name)"),
          db.from("profiles").select("user_id, full_name"),
        ]);
        const ids = new Set<string>();
        for (const r of kRoles || []) ids.add(r.user_id);
        for (const p of kPerms || []) ids.add(p.user_id);
        for (const m of kMembers || []) ids.add(m.user_id);
        for (const p of kProfiles || []) ids.add(p.user_id);
        ids.add(userId); // garante o próprio admin na lista

        const { data: list, error } = await authAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (error) throw error;
        const authById = new Map(list.users.map((u) => [u.id, u]));

        const users = Array.from(ids).map((id) => {
          const u = authById.get(id);
          const p = kPerms?.find((x) => x.user_id === id);
          return {
            id,
            email: u?.email ?? null,
            created_at: u?.created_at ?? null,
            last_sign_in_at: u?.last_sign_in_at ?? null,
            full_name: kProfiles?.find((x) => x.user_id === id)?.full_name || null,
            roles: (kRoles?.filter((r) => r.user_id === id).map((r) => r.role)) || [],
            workspaces: (kMembers?.filter((m) => m.user_id === id) || []).map((m: any) => ({
              workspace_id: m.workspace_id, role: m.role, name: m.workspaces?.name,
            })),
            permissions: {
              view_suggestions: !!p?.view_suggestions,
              view_integrations: !!p?.view_integrations,
              view_settings: !!p?.view_settings,
            },
            ghl_links: [], // vendedor/GHL é do módulo de Sugestões (futuramente)
          };
        });
        return json({ users });
      }

      case "list_workspaces": {
        const { data, error } = await db.from("workspaces").select("id, name, owner_id").order("created_at");
        if (error) throw error;
        return json({ workspaces: data });
      }

      case "list_ghl_users": {
        // Vendedor/GHL fora de escopo no Kommo (futuramente) — devolve vazio.
        return json({ ghl_users: [] });
      }

      case "create_user": {
        const { email, password, full_name, workspace_id, role = "user", permissions } = body;
        if (!email || !password) return json({ error: "email e password obrigatórios" }, 400);

        // auth.users é compartilhado: se já existir, anexa ao Kommo em vez de recriar.
        let newId: string | undefined;
        const { data: created, error: createErr } = await authAdmin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name },
        });
        if (createErr) {
          // Provável e-mail já cadastrado no auth (possivelmente usuário do GHL) → reaproveita.
          const { data: existing } = await authAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const found = existing?.users.find((u) => (u.email || "").toLowerCase() === String(email).toLowerCase());
          if (!found) throw createErr;
          newId = found.id;
        } else {
          newId = created.user!.id;
        }

        // profile (full_name) no kommo
        if (full_name) {
          await db.from("profiles").upsert({ user_id: newId, full_name }, { onConflict: "user_id" });
        }
        if (role === "admin") {
          await db.from("user_roles").upsert({ user_id: newId, role: "admin" }, { onConflict: "user_id,role" });
        }
        if (workspace_id) {
          await db.from("workspace_members").upsert(
            { user_id: newId, workspace_id, role: "member" }, { onConflict: "workspace_id,user_id" },
          );
        }
        await db.from("user_permissions").upsert({
          user_id: newId,
          view_suggestions: !!permissions?.view_suggestions,
          view_integrations: !!permissions?.view_integrations,
          view_settings: !!permissions?.view_settings,
        }, { onConflict: "user_id" });
        return json({ ok: true, user_id: newId });
      }

      case "set_permissions": {
        const { user_id, permissions } = body;
        if (!user_id || !permissions) return json({ error: "user_id e permissions obrigatórios" }, 400);
        const { error } = await db.from("user_permissions").upsert({
          user_id,
          view_suggestions: !!permissions.view_suggestions,
          view_integrations: !!permissions.view_integrations,
          view_settings: !!permissions.view_settings,
        }, { onConflict: "user_id" });
        if (error) throw error;
        return json({ ok: true });
      }

      case "update_password": {
        // ATENÇÃO: senha é da conta única (auth compartilhado) — muda também no GHL.
        const { user_id, password } = body;
        if (!user_id || !password) return json({ error: "user_id e password obrigatórios" }, 400);
        const { error } = await authAdmin.auth.admin.updateUserById(user_id, { password });
        if (error) throw error;
        return json({ ok: true });
      }

      case "delete_user": {
        // NÃO apaga do auth (conta compartilhada com o GHL). Só remove do Kommo.
        const { user_id } = body;
        if (!user_id) return json({ error: "user_id obrigatório" }, 400);
        if (user_id === userId) return json({ error: "Não pode remover a si mesmo" }, 400);
        await db.from("workspace_members").delete().eq("user_id", user_id);
        await db.from("user_permissions").delete().eq("user_id", user_id);
        await db.from("user_roles").delete().eq("user_id", user_id);
        await db.from("profiles").delete().eq("user_id", user_id);
        return json({ ok: true });
      }

      case "set_role": {
        const { user_id, role, enabled } = body;
        if (!user_id || !role) return json({ error: "user_id e role obrigatórios" }, 400);
        if (enabled) {
          await db.from("user_roles").upsert({ user_id, role }, { onConflict: "user_id,role" });
        } else {
          await db.from("user_roles").delete().eq("user_id", user_id).eq("role", role);
        }
        return json({ ok: true });
      }

      case "add_to_workspace": {
        const { user_id, workspace_id, role = "member" } = body;
        if (!user_id || !workspace_id) return json({ error: "user_id e workspace_id obrigatórios" }, 400);
        await db.from("workspace_members").upsert(
          { user_id, workspace_id, role }, { onConflict: "workspace_id,user_id" },
        );
        return json({ ok: true });
      }

      case "remove_from_workspace": {
        const { user_id, workspace_id } = body;
        if (!user_id || !workspace_id) return json({ error: "user_id e workspace_id obrigatórios" }, 400);
        await db.from("workspace_members").delete().eq("user_id", user_id).eq("workspace_id", workspace_id);
        return json({ ok: true });
      }

      case "set_ghl_link": {
        // Vendedor/GHL fora de escopo (futuramente) — no-op.
        return json({ ok: true });
      }

      case "promote_self_first_admin": {
        const { count } = await db.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
        if ((count || 0) > 0) return json({ error: "Já existe admin no sistema" }, 403);
        await db.from("user_roles").upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
        return json({ ok: true });
      }

      default:
        return json({ error: "Ação desconhecida" }, 400);
    }
  } catch (e) {
    console.error("kommo-admin-users error:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
