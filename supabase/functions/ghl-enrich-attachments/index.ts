// Conversas 2.0 — enriquecimento de attachments para a IA.
// Wrapper fino: auth/CORS/resolucao de credenciais + chama enrichPending de
// ../_shared/ghl-enrich.ts (mesma logica usada inline pelo tick do cron).
//
// Input: { workspace_id, ghl_conversation_id?, max?: number = 10 }
//   - se ghl_conversation_id for omitido, processa pendentes de qualquer conversa
//     do workspace.
// Auth: service / authenticated (admin ou membro) / anon (cron interno).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { reportEdgeError } from "../_shared/error-reporter.ts";
import { enrichPending, resolveAiKey } from "../_shared/ghl-enrich.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_MAX = 10;
const HARD_CAP = 100;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTs = Date.now();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let workspaceIdForStatus: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace("Bearer ", "").trim();
    let isServiceRole = token === SERVICE_KEY;
    if (!isServiceRole) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (payloadJson?.role === "service_role") isServiceRole = true;
        }
      } catch (_) { /* ignore */ }
    }

    const payload = await req.json().catch(() => ({} as Record<string, unknown>));
    const workspaceId = (payload.workspace_id as string) || null;
    const ghlConversationId = (payload.ghl_conversation_id as string) || null;
    const requestedMax = Number(payload.max) || DEFAULT_MAX;
    const maxMessages = Math.min(Math.max(1, requestedMax), HARD_CAP);
    if (!workspaceId) throw new Error("workspace_id e obrigatorio");
    workspaceIdForStatus = workspaceId;

    if (!isServiceRole) {
      let role = "unknown";
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          role = payloadJson?.role || "unknown";
        }
      } catch (_) { /* invalid */ }
      if (role === "authenticated") {
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (!user) throw new Error("Unauthorized");
        const [{ data: isAdmin }, { data: isMember }] = await Promise.all([
          supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
          supabase.rpc("is_workspace_member", { _user_id: user.id, _workspace_id: workspaceId }),
        ]);
        if (!isAdmin && !isMember) throw new Error("Forbidden");
      } else if (role !== "anon") {
        throw new Error("Unauthorized");
      }
    }

    // Workspace ativo
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id, owner_id, deleted_at")
      .eq("id", workspaceId)
      .maybeSingle();
    if (!ws) throw new Error("Workspace nao encontrado");
    if (ws.deleted_at) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "workspace_deleted" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { aiKey, aiModel } = await resolveAiKey(supabase, ws.owner_id ?? null);
    if (!aiKey) throw new Error("Nenhuma chave de IA configurada para esta conta. Configure sua chave de OpenAI em Configurações › IA.");

    // Marco de corte: nao enriquece midia anterior a entrada da conta no 2.0.
    const { data: wm } = await supabase
      .from("ghl_sync_watermarks")
      .select("enrich_cutoff_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const { scanned, enriched, errors } = await enrichPending(supabase, {
      workspaceId,
      ghlConversationId,
      max: maxMessages,
      aiKey,
      aiModel,
      ownerId: ws.owner_id as string,
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
      notBefore: wm?.enrich_cutoff_at ?? null,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        workspace_id: workspaceId,
        ghl_conversation_id: ghlConversationId,
        scanned,
        enriched,
        errors,
        duration_ms: Date.now() - startTs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = (err as Error).message || String(err);
    await reportEdgeError("ghl-enrich-attachments", err, {
      context: { workspace_id: workspaceIdForStatus },
    }).catch(() => {});
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
