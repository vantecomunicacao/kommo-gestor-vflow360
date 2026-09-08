// VFlow360 Kommo — kommo-admin-users
// Gestão de usuários do sistema Kommo. Espelha admin-users, mas opera SOMENTE no
// schema `kommo` (não toca em public/GHL).
//
// auth.users deste projeto é ISOLADO do GHL — o Kommo tem projeto Supabase
// próprio (`fjncmmqvmocwykpshgsh`) desde 2026-08-02; o GHL roda em outro projeto.
// Confirmado na Fase 0.1 do plano de remediação (2026-09-08): todos os usuários
// de auth.users aqui têm presença no `kommo.*`. Portanto:
//   - update_password: muda a senha SÓ do Kommo. Não tem efeito no GHL.
//   - create_user: ainda ANEXA se o e-mail já existir no auth (em vez de errar) —
//     defensivo; auth.users também lastreia public.profiles/has_role neste projeto.
//   - delete_user: NÃO apaga de auth.users — só remove a presença no kommo.*
//     (revoga acesso). É prática segura, não por causa de compartilhamento.
//   - list_users: escopado aos usuários com presença no kommo.*.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { resolveCallerIdentity } from "../_shared/authorize.ts";
import { corsHeadersBase as corsHeaders } from "../_shared/cors.ts";

// As 4 flags de kommo.user_permissions (ver migration 20260817120000). Validado
// aqui pra evitar o silent-fail de nome de campo errado no payload (!!undefined
// vira false sem avisar nada) — ja foi causa raiz de bug neste projeto.
const PermissionsSchema = z.object({
  view_cooling: z.boolean().optional().default(false),
  view_dashboard: z.boolean().optional().default(false),
  view_integrations: z.boolean().optional().default(false),
  view_settings: z.boolean().optional().default(false),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { userId } = await resolveCallerIdentity(req, SUPABASE_URL, ANON_KEY);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    // auth: client de service só para a Admin API (auth.users deste projeto Kommo).
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
        // Escopo: só usuários com presença no kommo.* (guarda defensiva —
        // auth.users deste projeto é Kommo-only, ver cabeçalho).
        const [{ data: kRoles }, { data: kPerms }, { data: kMembers }, { data: kProfiles }] = await Promise.all([
          db.from("user_roles").select("user_id, role"),
          db.from("user_permissions").select("user_id, view_cooling, view_dashboard, view_integrations, view_settings"),
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
            workspaces: (kMembers?.filter((m) => m.user_id === id) || []).map((m) => {
              // Embed é many-to-one (workspace_members.workspace_id -> workspaces.id),
              // PostgREST devolve objeto único; o client sem Database generics infere
              // como array por padrão — trata os dois formatos pra não depender disso.
              const ws = m.workspaces as unknown as { name?: string } | { name?: string }[] | null;
              const name = Array.isArray(ws) ? ws[0]?.name : ws?.name;
              return { workspace_id: m.workspace_id, role: m.role, name };
            }),
            permissions: {
              view_cooling: !!p?.view_cooling,
              view_dashboard: !!p?.view_dashboard,
              view_integrations: !!p?.view_integrations,
              view_settings: !!p?.view_settings,
            },
          };
        });
        return json({ users });
      }

      case "list_workspaces": {
        const { data, error } = await db.from("workspaces").select("id, name, owner_id").order("created_at");
        if (error) throw error;
        return json({ workspaces: data });
      }

      case "create_user": {
        const { email, password, full_name, workspace_id, role = "user", permissions } = body;
        if (!email || !password) return json({ error: "email e password obrigatórios" }, 400);

        // Se o e-mail já existir em auth.users (ex.: usuário recriado), anexa ao
        // Kommo em vez de errar. auth.users aqui é Kommo-only (ver cabeçalho).
        let newId: string | undefined;
        const { data: created, error: createErr } = await authAdmin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name },
        });
        if (createErr) {
          // Provável e-mail já cadastrado no auth → reaproveita o id existente.
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
        const newPerms = PermissionsSchema.parse(permissions ?? {});
        await db.from("user_permissions").upsert({
          user_id: newId,
          ...newPerms,
        }, { onConflict: "user_id" });
        return json({ ok: true, user_id: newId });
      }

      case "set_permissions": {
        const { user_id, permissions } = body;
        if (!user_id || !permissions) return json({ error: "user_id e permissions obrigatórios" }, 400);
        const parsed = PermissionsSchema.parse(permissions);
        const { error } = await db.from("user_permissions").upsert({
          user_id,
          ...parsed,
        }, { onConflict: "user_id" });
        if (error) throw error;
        return json({ ok: true });
      }

      case "update_password": {
        // Muda a senha SÓ do Kommo (auth.users deste projeto é isolado do GHL).
        const { user_id, password } = body;
        if (!user_id || !password) return json({ error: "user_id e password obrigatórios" }, 400);
        const { error } = await authAdmin.auth.admin.updateUserById(user_id, { password });
        if (error) throw error;
        return json({ ok: true });
      }

      case "delete_user": {
        // NÃO apaga de auth.users — só revoga o acesso removendo a presença no
        // kommo.*. Prática segura (auth lastreia public.profiles/has_role), não
        // por compartilhamento com GHL.
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
