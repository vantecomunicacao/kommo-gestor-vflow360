// VFlow360 Kommo — kommo-sync
// Snapshot do CRM Kommo → tabelas locais kommo.* (pipelines, users, loss_reasons,
// custom_fields, contacts, leads). Análogo ao ghl-sync, mas no schema `kommo` e
// SEM tocar em public.* (isolamento estrito).
//
// Credenciais (nesta fase M2): body { subdomain, token } OU env KOMMO_SUBDOMAIN/KOMMO_TOKEN.
// (M4 migra para kommo.integrations + Supabase Vault por workspace.)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  KommoCreds, normalizeSubdomain, kommoFetchAll,
  unixToIso, leadStatusKind, extractContactPhoneEmail,
} from "../_shared/kommo-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTs = Date.now();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  // Client com schema padrão `kommo`: todo .from() resolve em kommo.*
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "kommo" } });

  let workspaceId: string | null = null;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // --- workspace: obrigatório (sem fallback de teste) ---
    workspaceId = (body.workspace_id as string) || null;
    if (!workspaceId) throw new Error("workspace_id is required");

    // --- auth: se houver usuário no JWT, exige membership no workspace.
    // Sem usuário (cron postgres->edge com anon key) é permitido — o token vem do Vault. ---
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader ? authHeader.replace("Bearer ", "") : "";
    let userId: string | null = null;
    if (jwt) {
      try {
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        const { data: claims } = await userClient.auth.getClaims(jwt);
        userId = claims?.claims?.sub ?? null;
      } catch { userId = null; }
    }
    if (userId) {
      const { data: isMember } = await db.rpc("is_workspace_member", { _user_id: userId, _workspace_id: workspaceId });
      if (!isMember) throw new Error("Forbidden: not a member of this workspace");
    }

    // --- credenciais: SEMPRE da integração conectada + token no Vault (por workspace) ---
    const { data: intg } = await db.from("integrations")
      .select("id,subdomain,status").eq("workspace_id", workspaceId).eq("type", "kommo").maybeSingle();
    if (!intg || intg.status !== "connected") throw new Error("Kommo não conectado neste workspace");
    const subdomain = normalizeSubdomain(intg.subdomain || "");
    const { data: tok, error: tErr } = await db.rpc("get_integration_token", { p_integration_id: intg.id });
    if (tErr) throw tErr;
    const token = (tok as string) || "";
    if (!subdomain || !token) throw new Error("Credenciais Kommo ausentes (integração sem subdomínio/token no Vault)");
    const creds: KommoCreds = { subdomain, token };

    await db.from("sync_status").upsert(
      { workspace_id: workspaceId, is_running: true, last_sync_status: "running", last_sync_error: null },
      { onConflict: "workspace_id" },
    );

    const counts: Record<string, number> = {};

    // === 1. Pipelines (+ statuses embutidos) ===
    const pipelines = await kommoFetchAll(creds, "/leads/pipelines", "pipelines", { maxPages: 5 });
    if (pipelines.length) {
      const rows = pipelines.map((p: any) => ({
        workspace_id: workspaceId,
        kommo_id: String(p.id),
        name: p.name || "Sem nome",
        sort: p.sort ?? null,
        is_main: !!p.is_main,
        is_archive: !!p.is_archive,
        statuses: (p?._embedded?.statuses ?? []).map((s: any) => ({
          id: String(s.id), name: s.name, sort: s.sort, type: s.type, color: s.color,
        })),
      }));
      const { error } = await db.from("pipelines").upsert(rows, { onConflict: "workspace_id,kommo_id" });
      if (error) throw error;
    }
    counts.pipelines = pipelines.length;

    // === 2. Users ===
    const users = await kommoFetchAll(creds, "/users", "users", { maxPages: 10 });
    if (users.length) {
      const rows = users.map((u: any) => ({
        workspace_id: workspaceId,
        kommo_id: String(u.id),
        name: u.name || u.email || "Sem nome",
        email: u.email ?? null,
        is_active: u.is_active ?? true,
        is_admin: !!u?.rights?.is_admin,
      }));
      const { error } = await db.from("users").upsert(rows, { onConflict: "workspace_id,kommo_id" });
      if (error) throw error;
    }
    counts.users = users.length;

    // === 3. Loss reasons ===
    const lossReasons = await kommoFetchAll(creds, "/leads/loss_reasons", "loss_reasons", { maxPages: 10 });
    if (lossReasons.length) {
      const rows = lossReasons.map((l: any) => ({
        workspace_id: workspaceId,
        kommo_id: String(l.id),
        name: l.name || "Sem motivo",
        sort: l.sort ?? null,
      }));
      const { error } = await db.from("loss_reasons").upsert(rows, { onConflict: "workspace_id,kommo_id" });
      if (error) throw error;
    }
    counts.loss_reasons = lossReasons.length;

    // === 4. Custom fields (leads + contacts) ===
    const cfLeads = await kommoFetchAll(creds, "/leads/custom_fields", "custom_fields", { maxPages: 10 });
    const cfContacts = await kommoFetchAll(creds, "/contacts/custom_fields", "custom_fields", { maxPages: 10 });
    const cfRows = [
      ...cfLeads.map((f: any) => mapCustomField(workspaceId!, "leads", f)),
      ...cfContacts.map((f: any) => mapCustomField(workspaceId!, "contacts", f)),
    ];
    if (cfRows.length) {
      const { error } = await db.from("custom_fields").upsert(cfRows, { onConflict: "workspace_id,entity_type,kommo_id" });
      if (error) throw error;
    }
    counts.custom_fields = cfRows.length;

    // === 5. Contacts (com phone/email extraídos dos custom fields) ===
    const contacts = await kommoFetchAll(creds, "/contacts?limit=250", "contacts", { maxPages: 40 });
    if (contacts.length) {
      const rows = contacts.map((c: any) => {
        const { phone, email } = extractContactPhoneEmail(c.custom_fields_values);
        return {
          workspace_id: workspaceId,
          kommo_id: String(c.id),
          name: c.name ?? null,
          phone, email,
          responsible_user_id: c.responsible_user_id != null ? String(c.responsible_user_id) : null,
          custom_fields: c.custom_fields_values ?? [],
          kommo_created_at: unixToIso(c.created_at),
          kommo_updated_at: unixToIso(c.updated_at),
        };
      });
      await upsertChunked(db, "contacts", rows, "workspace_id,kommo_id");
    }
    counts.contacts = contacts.length;

    // === 6. Leads (entidade central do dashboard) ===
    const leads = await kommoFetchAll(creds, "/leads?limit=250&with=contacts", "leads", { maxPages: 60 });
    if (leads.length) {
      const rows = leads.map((l: any) => {
        const mainContactId = l?._embedded?.contacts?.[0]?.id ?? null;
        return {
          workspace_id: workspaceId,
          kommo_id: String(l.id),
          name: l.name ?? null,
          pipeline_id: l.pipeline_id != null ? String(l.pipeline_id) : null,
          status_id: l.status_id != null ? String(l.status_id) : null,
          status: leadStatusKind(l.status_id),
          price: typeof l.price === "number" ? l.price : null,
          responsible_user_id: l.responsible_user_id != null ? String(l.responsible_user_id) : null,
          loss_reason_id: l.loss_reason_id != null ? String(l.loss_reason_id) : null,
          source: null,
          contact_id: mainContactId != null ? String(mainContactId) : null,
          custom_fields: l.custom_fields_values ?? {},
          is_deleted: !!l.is_deleted,
          kommo_created_at: unixToIso(l.created_at),
          kommo_updated_at: unixToIso(l.updated_at),
          closed_at: unixToIso(l.closed_at),
        };
      });
      await upsertChunked(db, "leads", rows, "workspace_id,kommo_id");
    }
    counts.leads = leads.length;

    // === status final ===
    await db.from("sync_status").upsert({
      workspace_id: workspaceId,
      is_running: false,
      last_sync_status: "success",
      last_sync_error: null,
      last_sync_at: new Date().toISOString(),
      last_sync_duration_ms: Date.now() - startTs,
      leads_count: counts.leads ?? 0,
    }, { onConflict: "workspace_id" });

    return new Response(
      JSON.stringify({ success: true, workspace_id: workspaceId, counts, duration_ms: Date.now() - startTs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = serializeErr(e);
    console.error("kommo-sync error:", msg);
    if (workspaceId) {
      await db.from("sync_status").upsert({
        workspace_id: workspaceId, is_running: false, last_sync_status: "error", last_sync_error: msg.slice(0, 1000),
      }, { onConflict: "workspace_id" }).catch(() => {});
    }
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/** Serializa Error, PostgrestError ({message,code,details,hint}) ou objeto qualquer. */
function serializeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (o.message) return [o.message, o.code, o.details, o.hint].filter(Boolean).join(" | ");
    try { return JSON.stringify(o); } catch { return String(e); }
  }
  return String(e);
}

function mapCustomField(workspaceId: string, entity: "leads" | "contacts", f: any) {
  return {
    workspace_id: workspaceId,
    kommo_id: String(f.id),
    entity_type: entity,
    name: f.name || "Sem nome",
    code: f.code ?? null,
    field_type: f.type ?? null,
    enums: f.enums ?? null,
    is_predefined: !!f.is_predefined,
    sort: f.sort ?? null,
  };
}

/** Upsert em lotes (evita payloads gigantes). */
async function upsertChunked(db: any, table: string, rows: any[], onConflict: string, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
  }
}
