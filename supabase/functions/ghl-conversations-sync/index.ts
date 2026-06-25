// Conversas 2.0 — sync incremental de conversas do GHL para ghl_conversations.
// Roda por workspace. Usa watermark (maior ghl_date_updated visto) para
// paginar so o que mudou desde a ultima rodada.
//
// Mensagens das conversas: lazy load on-demand (ao abrir conversa na UI).
// BACKFILL automatico de mensagens NAO esta implementado nesta funcao
// (tentativa abortada em 2026-06-03 — ver memoria [[feedback-edge-fn-no-http]]).
//
// Input: { workspace_id: string, full?: boolean }
//   - full=true ignora watermark (faz backfill completo da lista). Cap: 2000.
// Auth: service / authenticated (admin ou membro) / anon (cron interno).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { reportEdgeError } from "../_shared/error-reporter.ts";
import { syncConversationMessages } from "../_shared/ghl-sync.ts";
import { enrichPending, resolveAiKey } from "../_shared/ghl-enrich.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const PAGE_SIZE = 100;
const SAFETY_CAP = 2000; // teto de conversas por execucao

// Pipeline automatico (modelo Conversas 2.0):
const HEAT_CONTEXT_MESSAGES = 20; // janela de mensagens ao "esquentar" uma conversa
const CONV_SYNC_CAP = 30; // max de conversas com inbound novo processadas por tick
const ENRICH_CAP = 20; // max de mensagens enriquecidas por tick (mídia é lenta)
const DEBOUNCE_MS = 5 * 60 * 1000; // espera o lead parar de mandar (5 min)
const CEILING_MS = 15 * 60 * 1000; // teto: nao espera mais que isso numa rajada

interface GhlConversation {
  id: string;
  locationId: string;
  contactId: string;
  fullName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  profilePhoto?: string;
  lastMessageType?: string;
  lastMessageBody?: string;
  lastMessageDirection?: string;
  lastMessageDate?: number;
  unreadCount?: number;
  assignedTo?: string;
  dateAdded?: number;
  dateUpdated?: number;
}

async function ghlSearchConversations(
  apiKey: string,
  locationId: string,
  startAfterDate?: number,
): Promise<GhlConversation[]> {
  const url = new URL(`${GHL_BASE_URL}/conversations/search`);
  url.searchParams.set("locationId", locationId);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("sort", "desc");
  url.searchParams.set("sortBy", "last_message_date");
  if (startAfterDate) url.searchParams.set("startAfterDate", String(startAfterDate));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GHL conversations/search ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text);
  return (json?.conversations || []) as GhlConversation[];
}

function tsToIso(ms?: number): string | null {
  if (!ms || typeof ms !== "number") return null;
  return new Date(ms).toISOString();
}

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
    // Detect service role: string match primeiro, JWT decode como fallback
    // (env vars podem ter trailing whitespace e quebrar o comparison).
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
    const fullBackfill = payload.full === true;
    if (!workspaceId) throw new Error("workspace_id e obrigatorio");
    workspaceIdForStatus = workspaceId;

    // Auth: aceita service role (cron interno), JWT autenticado (membro do
    // workspace ou admin) OU anon key (chamadas internas do cron via pg_net,
    // mesmo padrao do analyze-scheduler). A entrada e segura porque a funcao
    // so escreve em ghl_conversations (RLS-protegida) e o input e
    // limitado a workspace_id que ja tem GHL conectado.
    if (!isServiceRole) {
      let role = "unknown";
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          role = payloadJson?.role || "unknown";
        }
      } catch (_) { /* invalid token shape -> rejeita abaixo */ }

      if (role === "authenticated") {
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user }, error: authError } = await userClient.auth.getUser();
        if (authError || !user) throw new Error("Unauthorized");
        // Admin bypass + membership check.
        const [{ data: isAdmin }, { data: isMember }] = await Promise.all([
          supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
          supabase.rpc("is_workspace_member", {
            _user_id: user.id,
            _workspace_id: workspaceId,
          }),
        ]);
        if (!isAdmin && !isMember) {
          throw new Error("Forbidden: nao e membro deste workspace");
        }
      } else if (role !== "anon") {
        throw new Error("Unauthorized");
      }
      // anon role -> aceita (cron interno)
    }

    // Workspace ativo? (soft-delete = pular sync, mesmo se integration estiver 'connected')
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id, owner_id, deleted_at")
      .eq("id", workspaceId)
      .maybeSingle();
    if (!ws) throw new Error("Workspace nao encontrado");
    if (ws.deleted_at) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "workspace_deleted", workspace_id: workspaceId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // GHL credentials
    const { data: integration } = await supabase
      .from("integrations")
      .select("config, status")
      .eq("type", "ghl")
      .eq("workspace_id", workspaceId)
      .eq("status", "connected")
      .maybeSingle();
    if (!integration) throw new Error("Nenhuma integracao GHL conectada neste workspace");
    const cfg = (integration.config || {}) as Record<string, unknown>;
    const apiKey = (cfg.apiKey || cfg.api_key) as string;
    const locationId = (cfg.locationId || cfg.location_id) as string;
    if (!apiKey || !locationId) throw new Error("Credenciais GHL incompletas");

    // Watermark
    const { data: wm } = await supabase
      .from("ghl_sync_watermarks")
      .select("conversations_last_seen_at, enrich_cutoff_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const watermarkMs = fullBackfill || !wm?.conversations_last_seen_at
      ? 0
      : new Date(wm.conversations_last_seen_at).getTime();

    // No backfill inicial (full ou primeira rodada sem watermark), trazemos so
    // a LISTA (conversas entram "frias"). O auto-heat so vale para ticks
    // incrementais: conversas que realmente mudaram desde o ultimo watermark.
    const isInitial = fullBackfill || !wm?.conversations_last_seen_at;
    // touchedIds: conversas com QUALQUER atividade nova (inbound ou outbound) ->
    // sincroniza mensagens, para o espelho local ficar completo (tempo de
    // resposta correto). touchedInboundIds: subconjunto inbound -> dispara analise.
    const touchedIds = new Set<string>();
    const touchedInboundIds = new Set<string>();

    // Paginate from newest backwards until watermark or safety cap
    let cursorDate: number | undefined = undefined;
    let totalSynced = 0;
    let maxDateUpdatedSeen = 0;
    let pages = 0;

    while (totalSynced < SAFETY_CAP) {
      const batch = await ghlSearchConversations(apiKey, locationId, cursorDate);
      pages++;
      if (!batch.length) break;

      // Map -> ghl_conversations rows
      const rows = batch.map((c) => {
        const dateUpdated = c.dateUpdated || c.lastMessageDate || c.dateAdded || 0;
        if (dateUpdated > maxDateUpdatedSeen) maxDateUpdatedSeen = dateUpdated;
        return {
          workspace_id: workspaceId,
          ghl_conversation_id: c.id,
          ghl_location_id: c.locationId || locationId,
          ghl_contact_id: c.contactId,
          contact_name: c.fullName || c.contactName || null,
          contact_phone: c.phone || null,
          contact_email: c.email || null,
          profile_photo_url: c.profilePhoto || null,
          channel_type: c.lastMessageType || null,
          last_message_at: tsToIso(c.lastMessageDate),
          last_message_body: c.lastMessageBody || null,
          last_message_direction: c.lastMessageDirection || null,
          unread_count: typeof c.unreadCount === "number" ? c.unreadCount : 0,
          assigned_ghl_user_id: c.assignedTo || null,
          ghl_date_added: tsToIso(c.dateAdded),
          ghl_date_updated: tsToIso(dateUpdated),
          synced_at: new Date().toISOString(),
        };
      });

      // Upsert
      const { error: upErr } = await supabase
        .from("ghl_conversations")
        .upsert(rows, { onConflict: "workspace_id,ghl_conversation_id" });
      if (upErr) throw new Error(`Upsert falhou: ${upErr.message}`);
      totalSynced += rows.length;

      // Coleta conversas tocadas neste tick (so em incremental). Sincronizamos
      // mensagens de TODAS (inbound ou outbound); a analise so dispara nas inbound.
      if (!isInitial) {
        for (const c of batch) {
          touchedIds.add(c.id);
          // Atividade do GHL (TYPE_ACTIVITY*) NAO e fala do lead: nao pode
          // disparar analise mesmo que venha marcada como inbound.
          const isActivity = (c.lastMessageType || "").toUpperCase().startsWith("TYPE_ACTIVITY");
          if (!isActivity && (c.lastMessageDirection || "").toLowerCase() === "inbound") {
            touchedInboundIds.add(c.id);
          }
        }
      }

      // Stop conditions
      const oldestInBatch = batch[batch.length - 1];
      const oldestDateUpdated = oldestInBatch?.dateUpdated || oldestInBatch?.lastMessageDate || 0;

      // Last page
      if (batch.length < PAGE_SIZE) break;
      // Reached watermark (everything newer than watermark already covered)
      if (!fullBackfill && watermarkMs && oldestDateUpdated <= watermarkMs) break;

      // Advance cursor (date-based pagination, exclusive)
      cursorDate = oldestInBatch?.lastMessageDate;
      if (!cursorDate) break;
    }

    // Update watermark
    const newWatermarkMs = Math.max(maxDateUpdatedSeen, watermarkMs);
    await supabase
      .from("ghl_sync_watermarks")
      .upsert({
        workspace_id: workspaceId,
        conversations_last_seen_at: newWatermarkMs ? new Date(newWatermarkMs).toISOString() : null,
        last_run_at: new Date().toISOString(),
        last_run_status: "ok",
        last_run_error: null,
        last_run_count: totalSynced,
      }, { onConflict: "workspace_id" });

    // Marco de corte do enriquecimento: setado UMA vez (primeiro sync da conta).
    // Midia anterior a este instante nunca e tratada com IA.
    await supabase
      .from("ghl_sync_watermarks")
      .update({ enrich_cutoff_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .is("enrich_cutoff_at", null);

    // ============================================================
    // Pipeline automatico: sincroniza mensagens das conversas tocadas (qualquer
    // direcao -> espelho local completo p/ tempo de resposta), enriquece midia
    // nova e, SO para inbound, agenda a analise (debounce). Tudo INLINE (sem
    // edge->edge). Falhas aqui nao derrubam o sync da lista, ja persistido acima.
    // ============================================================
    let heated = 0;
    let enrichedCount = 0;
    try {
      const candidates = touchedIds.size === 0 ? [] : (await supabase
        .from("ghl_conversations")
        .select("ghl_conversation_id, last_message_at, messages_synced_until, analyze_started_at")
        .eq("workspace_id", workspaceId)
        .in("ghl_conversation_id", [...touchedIds])
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(CONV_SYNC_CAP)).data;

      const toSync = (candidates || []).filter((c) => {
        const lm = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
        const synced = c.messages_synced_until ? new Date(c.messages_synced_until).getTime() : 0;
        return lm > synced;
      });

      for (const c of toSync) {
        try {
          await syncConversationMessages(supabase, {
            workspaceId,
            ghlConversationId: c.ghl_conversation_id,
            apiKey,
            maxMessages: HEAT_CONTEXT_MESSAGES,
          });

          // Marca como sincronizado ate a ultima msg da lista -> nao re-sincroniza
          // no proximo tick (so volta se chegar mensagem mais nova).
          const update: Record<string, unknown> = {
            messages_synced_until: c.last_message_at,
          };

          // Analise (debounce) SO para inbound do lead — vendedor (outbound) nao
          // dispara sugestao. Espelha o modelo 1.0 (espera o lead parar, com teto).
          if (touchedInboundIds.has(c.ghl_conversation_id)) {
            const nowMs = Date.now();
            const startedMs = c.analyze_started_at ? new Date(c.analyze_started_at).getTime() : 0;
            const ceilingReached = startedMs && (nowMs - startedMs >= CEILING_MS);
            update.analyze_after = ceilingReached
              ? new Date(nowMs).toISOString()
              : new Date(nowMs + DEBOUNCE_MS).toISOString();
            if (!startedMs) update.analyze_started_at = new Date(nowMs).toISOString();
          }

          await supabase
            .from("ghl_conversations")
            .update(update)
            .eq("workspace_id", workspaceId)
            .eq("ghl_conversation_id", c.ghl_conversation_id);
          heated++;
        } catch (convErr) {
          console.warn(`sync falhou conv ${c.ghl_conversation_id}:`, (convErr as Error).message);
        }
      }

      // Enriquece a midia nova (newest pending do workspace), com teto por tick.
      if (heated > 0) {
        const { aiKey, aiModel } = await resolveAiKey(
          supabase,
          ws.owner_id ?? null,
        );
        if (aiKey) {
          const r = await enrichPending(supabase, {
            workspaceId,
            max: ENRICH_CAP,
            aiKey,
            aiModel,
            ownerId: (ws.owner_id as string) || "",
            supabaseUrl: SUPABASE_URL,
            serviceKey: SERVICE_KEY,
            notBefore: wm?.enrich_cutoff_at ?? null,
          });
          enrichedCount = r.enriched;
        }
      }
    } catch (pipeErr) {
      console.warn("pipeline automatico (heat/enrich) falhou:", (pipeErr as Error).message);
    }

    const durationMs = Date.now() - startTs;
    return new Response(
      JSON.stringify({
        ok: true,
        workspace_id: workspaceId,
        synced: totalSynced,
        pages,
        watermark: newWatermarkMs ? new Date(newWatermarkMs).toISOString() : null,
        full_backfill: fullBackfill,
        heated,
        enriched: enrichedCount,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (workspaceIdForStatus) {
      await supabase
        .from("ghl_sync_watermarks")
        .upsert({
          workspace_id: workspaceIdForStatus,
          last_run_at: new Date().toISOString(),
          last_run_status: "error",
          last_run_error: msg.slice(0, 500),
        }, { onConflict: "workspace_id" })
        .then(() => {}, () => {});
    }
    await reportEdgeError("ghl-conversations-sync", err, {
      context: { workspace_id: workspaceIdForStatus },
    }).catch(() => {});
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
