// VFlow360 Kommo — kommo-admin-bootstrap
// Permite que o PRIMEIRO usuário autenticado vire admin se ainda não houver admin
// no schema `kommo`. Espelha admin-bootstrap, mas opera SOMENTE em kommo.* (não toca
// no schema public/GHL). auth.users é compartilhado — aqui só lemos o caller.
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
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    let userId: string | undefined;
    let userEmail: string | undefined;
    try {
      const { data: claims } = await (userClient.auth as any).getClaims(token);
      const c = claims?.claims ?? claims;
      userId = c?.sub; userEmail = c?.email;
    } catch (_) { /* fallback abaixo */ }
    if (!userId) {
      const { data: u } = await userClient.auth.getUser(token);
      userId = u?.user?.id; userEmail = u?.user?.email ?? userEmail;
    }
    if (!userId) return json({ error: "Unauthorized" }, 401);

    // Client no schema kommo: todo .from() resolve em kommo.*
    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: "kommo" } });
    const { count } = await db.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");

    if ((count || 0) > 0) {
      const { data: mine } = await db.from("user_roles")
        .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
      return json({ has_admin: true, is_admin: !!mine });
    }

    // Allowlist opcional (CSV de e-mails). Vazia = primeiro autenticado vira admin.
    const allowlistRaw = Deno.env.get("ADMIN_BOOTSTRAP_ALLOWLIST") || "";
    if (allowlistRaw.trim().length > 0) {
      const allowed = new Set(allowlistRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
      const emailLower = (userEmail || "").toLowerCase();
      if (!emailLower || !allowed.has(emailLower)) return json({ error: "Forbidden" }, 403);
    }

    await db.from("user_roles").upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
    return json({ has_admin: true, is_admin: true, promoted: true });
  } catch (e) {
    console.error("kommo-admin-bootstrap error:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
