// Public endpoint that persists log entries from the frontend.
// JWT verification disabled — anyone can post a log; service role inserts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { corsHeadersBase as corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const level = ["error", "warning", "info"].includes(body?.level) ? body.level : "error";
    const source = String(body?.source ?? "frontend:unknown").slice(0, 200);
    const message = String(body?.message ?? "Unknown").slice(0, 4000);
    const stack = body?.stack ? String(body.stack).slice(0, 8000) : null;
    const context = body?.context && typeof body.context === "object" ? body.context : {};
    const url = body?.url ? String(body.url).slice(0, 500) : null;
    const user_agent = body?.user_agent ? String(body.user_agent).slice(0, 500) : null;
    const env = body?.env ? String(body.env).slice(0, 50) : null;
    const workspace_id = body?.workspace_id ?? null;
    const user_id = body?.user_id ?? null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    await supabase.from("system_logs").insert({
      level,
      source,
      message,
      stack,
      context,
      url,
      user_agent,
      env,
      workspace_id,
      user_id,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, // never propagate errors back to clients
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
