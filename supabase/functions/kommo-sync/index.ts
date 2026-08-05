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
import { authorizeWorkspace } from "../_shared/authorize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

// Intervalo mínimo entre syncs MANUAIS de usuário (server-side, não burlável).
const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

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

    // --- auth: JWT válido + membership (usuário) OU segredo interno (cron
    // postgres->edge com x-internal-secret). Ver _shared/authorize.ts. ---
    const auth = await authorizeWorkspace({ req, db, supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, workspaceId });

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

    // --- Sonda de diagnóstico (read-only): quando/quem excluiu leads. Não grava nada,
    // não sincroniza. `probe_deletions: true` → busca eventos lead_deleted e retorna
    // { lead_id, deleted_at, by_user_id }. Filtra por `ids` se enviado. ---
    if (body.probe_deletions === true) {
      const wantIds: Set<string> | null = Array.isArray(body.ids)
        ? new Set((body.ids as unknown[]).map((x) => String(x))) : null;
      const evts = await kommoFetchAll(
        creds, `/events?limit=100&filter[type]=lead_deleted&filter[entity]=lead`, "events", { maxPages: 30 },
      );
      const out = evts
        .map((e: any) => ({
          lead_id: e.entity_id != null ? String(e.entity_id) : null,
          deleted_at: unixToIso(e.created_at),
          by_user_id: e.created_by != null ? String(e.created_by) : null,
        }))
        .filter((r: any) => r.lead_id && (!wantIds || wantIds.has(r.lead_id)));
      return new Response(JSON.stringify({ success: true, probe: "deletions", count: out.length, events: out }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Cooldown do "Atualizar agora" (server-side, não burlável) ---
    // Só vale para sync MANUAL de usuário: cron (segredo interno), full-scan e a
    // sonda não entram. Antes o cooldown vivia no localStorage do frontend e era
    // contornável limpando o storage; agora a autoridade é o sync_status.last_sync_at.
    const isManualUserSync = auth.via === "user" && body.cron !== true && body.full !== true;
    if (isManualUserSync) {
      const { data: st } = await db.from("sync_status")
        .select("last_sync_at,is_running").eq("workspace_id", workspaceId).maybeSingle();
      const lastMs = st?.last_sync_at ? new Date(st.last_sync_at).getTime() : 0;
      const elapsed = Date.now() - lastMs;
      if (st?.is_running || (lastMs && elapsed < SYNC_COOLDOWN_MS)) {
        const wait = st?.is_running ? 30 : Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 1000);
        return new Response(JSON.stringify({ error: `COOLDOWN:${wait}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // --- Sync incremental: lê os watermarks por entidade. NULL → full-scan
    // (1ª sync ou pós-troca de conta, quando kommo-manage limpa a linha). ---
    const OVERLAP_MS = 2 * 60_000; // sobreposição p/ não perder linhas alteradas durante a rodada
    const { data: wm } = await db.from("sync_watermarks")
      .select("leads_last_seen_at,contacts_last_seen_at,tasks_last_seen_at,events_last_seen_at")
      .eq("workspace_id", workspaceId).maybeSingle();
    // Fragmento `&filter[campo][from]=<unix seg>` p/ acrescentar na URL, ou "" (full-scan).
    const sinceParam = (iso: string | null | undefined, field: "updated_at" | "created_at") => {
      if (!iso) return "";
      const sec = Math.floor(new Date(iso).getTime() / 1000);
      return Number.isFinite(sec) ? `&filter[${field}][from]=${sec}` : "";
    };
    // `full: true` no body força um re-sync completo (ignora watermarks) — útil p/ operação.
    const forceFull = body.full === true;
    const leadsSince    = forceFull ? "" : sinceParam(wm?.leads_last_seen_at,    "updated_at");
    const contactsSince = forceFull ? "" : sinceParam(wm?.contacts_last_seen_at, "updated_at");
    const tasksSince    = forceFull ? "" : sinceParam(wm?.tasks_last_seen_at,    "updated_at");
    const eventsSince   = forceFull ? "" : sinceParam(wm?.events_last_seen_at,   "created_at");
    const newWatermark  = new Date(startTs - OVERLAP_MS).toISOString();

    await db.from("sync_status").upsert(
      { workspace_id: workspaceId, is_running: true, last_sync_status: "running", last_sync_error: null },
      { onConflict: "workspace_id" },
    );

    const counts: Record<string, number> = {};
    let stageEventsError: string | null = null;
    let tasksError: string | null = null;
    const warnings: string[] = [];

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
        is_deleted: false, // veio no snapshot → vivo (ressuscita funil antes marcado)
        statuses: (p?._embedded?.statuses ?? []).map((s: any) => ({
          id: String(s.id), name: s.name, sort: s.sort, type: s.type, color: s.color,
        })),
      }));
      const { error } = await db.from("pipelines").upsert(rows, { onConflict: "workspace_id,kommo_id" });
      if (error) throw error;

      // Reconciliação de exclusão: o endpoint /leads/pipelines devolve SEMPRE o
      // catálogo completo (não é incremental), então funil que não veio foi apagado
      // no Kommo. Soft delete p/ não perder o nome no histórico dos leads antigos.
      // Só roda quando a busca trouxe algo — resposta vazia é falha/timeout, e
      // marcar tudo como apagado esvaziaria os seletores do cliente.
      const aliveIds = rows.map((r) => r.kommo_id);
      const { error: delError } = await db.from("pipelines")
        .update({ is_deleted: true })
        .eq("workspace_id", workspaceId)
        .eq("is_deleted", false)
        .not("kommo_id", "in", `(${aliveIds.map((id) => `"${id}"`).join(",")})`);
      if (delError) throw delError;
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
    const CONTACTS_MAX_PAGES = 100, CONTACTS_PAGE = 250;
    const contacts = await kommoFetchAll(creds, `/contacts?limit=${CONTACTS_PAGE}${contactsSince}`, "contacts", { maxPages: CONTACTS_MAX_PAGES });
    // Mapa id→dados usado abaixo para denormalizar contact_name/phone/email em
    // kommo.leads (evita join no dashboard). Num sync incremental (contactsSince
    // ativo) só cobre contatos alterados no período — os demais leads mantêm o
    // que já está gravado no upsert anterior.
    const contactById = new Map<string, { name: string | null; phone: string | null; email: string | null }>();
    if (contacts.length) {
      const rows = contacts.map((c: any) => {
        const { phone, email } = extractContactPhoneEmail(c.custom_fields_values);
        contactById.set(String(c.id), { name: c.name ?? null, phone, email });
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
    const hitContactsPageCap = contacts.length >= CONTACTS_MAX_PAGES * CONTACTS_PAGE;
    if (hitContactsPageCap) {
      warnings.push(
        `contacts: atingiu o teto de ${CONTACTS_MAX_PAGES * CONTACTS_PAGE} registros — pode haver contatos não sincronizados`,
      );
    }

    // === 6. Leads (entidade central do dashboard) ===
    const LEADS_MAX_PAGES = 60, LEADS_PAGE = 250;
    const leads = await kommoFetchAll(creds, `/leads?limit=${LEADS_PAGE}&with=contacts${leadsSince}`, "leads", { maxPages: LEADS_MAX_PAGES });
    if (leads.length) {
      // Num sync incremental, `contactById` só tem os contatos alterados neste
      // tick — busca no banco os IDs que faltam pra não gravar contact_name/
      // phone/email como null e apagar o que já estava denormalizado em leads.
      const missingContactIds = Array.from(new Set(
        leads
          .map((l: any) => l?._embedded?.contacts?.[0]?.id)
          .filter((id: unknown) => id != null)
          .map((id: unknown) => String(id))
          .filter((id: string) => !contactById.has(id)),
      ));
      if (missingContactIds.length) {
        const { data: existingContacts } = await db.from("contacts")
          .select("kommo_id,name,phone,email")
          .eq("workspace_id", workspaceId)
          .in("kommo_id", missingContactIds);
        for (const c of (existingContacts || []) as any[]) {
          contactById.set(String(c.kommo_id), { name: c.name ?? null, phone: c.phone ?? null, email: c.email ?? null });
        }
      }
      const rows = leads.map((l: any) => {
        const mainContactId = l?._embedded?.contacts?.[0]?.id ?? null;
        const contact = mainContactId != null ? contactById.get(String(mainContactId)) : undefined;
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
          contact_name: contact?.name ?? null,
          contact_phone: contact?.phone ?? null,
          contact_email: contact?.email ?? null,
          custom_fields: l.custom_fields_values ?? {},
          is_deleted: !!l.is_deleted,
          kommo_created_at: unixToIso(l.created_at),
          kommo_updated_at: unixToIso(l.updated_at),
          closed_at: unixToIso(l.closed_at),
          closest_task_at: unixToIso(l.closest_task_at),
        };
      });
      await upsertChunked(db, "leads", rows, "workspace_id,kommo_id");
    }
    counts.leads = leads.length;

    // === 6b. Reconciliação de exclusões (só no full-scan) ===
    // Um lead apagado no Kommo some da resposta de /leads e NUNCA volta marcado
    // (l.is_deleted não ajuda: o registro nem vem no payload). Então, num full-scan,
    // tudo que existe localmente mas não veio agora foi excluído no Kommo → is_deleted.
    // Só é seguro no full-scan (leadsSince === ""); no incremental não há visão completa.
    // Guarda: se a busca bateu no teto de páginas, o retorno pode estar truncado —
    // nesse caso NÃO reconcilia (evitaria marcar leads válidos como excluídos).
    // dry_run: faz a varredura e reporta o que SERIA marcado, sem gravar nada.
    const dryRun = body.dry_run === true;
    const hitPageCap = leads.length >= LEADS_MAX_PAGES * LEADS_PAGE;
    if (hitPageCap) {
      warnings.push(
        `leads: atingiu o teto de ${LEADS_MAX_PAGES * LEADS_PAGE} registros — pode haver leads não sincronizados`,
      );
    }
    if (leadsSince === "" && !hitPageCap) {
      const seen = new Set(leads.map((l: any) => String(l.id)));
      const { data: localLeads } = await db.from("leads")
        .select("kommo_id").eq("workspace_id", workspaceId).neq("is_deleted", true);
      const missing = (localLeads ?? [])
        .map((r: any) => r.kommo_id as string)
        .filter((id: string) => !seen.has(id));
      if (!dryRun) {
        for (let i = 0; i < missing.length; i += 200) {
          const chunk = missing.slice(i, i + 200);
          const { error } = await db.from("leads").update({ is_deleted: true })
            .eq("workspace_id", workspaceId).in("kommo_id", chunk);
          if (error) throw error;
        }
      }
      counts.leads_deleted_reconciled = missing.length;
      counts.leads_deleted_dry_run = dryRun ? 1 : 0;
      // amostra p/ inspeção no dry-run (limita p/ não estourar a resposta)
      (counts as any).leads_deleted_ids = missing.slice(0, 100);
    } else if (leadsSince === "" && hitPageCap) {
      counts.leads_deleted_reconciled = -1; // sinaliza: pulado por teto de páginas
    }

    // === 7. Eventos de mudança de etapa (histórico → tempo por etapa / velocidade) ===
    // Resiliente: se falhar, NÃO derruba o sync (leads já foram gravados). Limitado
    // para não estourar o tempo da função (incremental fica como melhoria futura).
    try {
      const stageEvents = await kommoFetchAll(
        creds, `/events?limit=100&filter[type]=lead_status_changed&filter[entity]=lead${eventsSince}`, "events", { maxPages: 15 },
      );
      if (stageEvents.length) {
        const evRows = stageEvents.map((e: any) => {
          const after = e?.value_after?.[0]?.lead_status ?? {};
          const before = e?.value_before?.[0]?.lead_status ?? {};
          return {
            workspace_id: workspaceId,
            event_id: String(e.id),
            lead_id: e.entity_id != null ? String(e.entity_id) : "",
            pipeline_id: after.pipeline_id != null ? String(after.pipeline_id)
              : (before.pipeline_id != null ? String(before.pipeline_id) : null),
            before_status_id: before.id != null ? String(before.id) : null,
            after_status_id: after.id != null ? String(after.id) : null,
            changed_at: unixToIso(e.created_at),
          };
        }).filter((r: any) => r.event_id && r.lead_id && r.changed_at);
        if (evRows.length) await upsertChunked(db, "lead_stage_events", evRows, "workspace_id,event_id");
        counts.stage_events = evRows.length;
      } else {
        counts.stage_events = 0;
      }
    } catch (evErr) {
      stageEventsError = serializeErr(evErr).slice(0, 300);
    }

    // === 8. Tarefas (follow-up: atrasadas + leads sem próxima ação) ===
    try {
      const tasks = await kommoFetchAll(creds, `/tasks?limit=250${tasksSince}`, "tasks", { maxPages: 20 });
      const taskRows = tasks
        .filter((t: any) => t.entity_type === "leads")
        .map((t: any) => ({
          workspace_id: workspaceId,
          kommo_id: String(t.id),
          lead_id: t.entity_id != null ? String(t.entity_id) : null,
          responsible_user_id: t.responsible_user_id != null ? String(t.responsible_user_id) : null,
          complete_till: unixToIso(t.complete_till),
          is_completed: !!t.is_completed,
          task_type_id: t.task_type_id != null ? String(t.task_type_id) : null,
          text: typeof t.text === "string" ? t.text.slice(0, 500) : null,
          kommo_created_at: unixToIso(t.created_at),
          kommo_updated_at: unixToIso(t.updated_at),
        }))
        .filter((r: any) => r.kommo_id);
      if (taskRows.length) await upsertChunked(db, "tasks", taskRows, "workspace_id,kommo_id");
      counts.tasks = taskRows.length;
    } catch (tErr) {
      tasksError = serializeErr(tErr).slice(0, 300);
    }

    // === status final ===
    // Numa rodada incremental `counts.leads` é só o delta; o total exibido vem de um
    // COUNT real na tabela (não-deletados), correto tanto no full-scan quanto no delta.
    const { count: totalLeadsCount } = await db.from("leads")
      .select("kommo_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).neq("is_deleted", true);

    if (stageEventsError) warnings.push(`eventos de etapa: ${stageEventsError}`);
    if (tasksError) warnings.push(`tarefas: ${tasksError}`);

    await db.from("sync_status").upsert({
      workspace_id: workspaceId,
      is_running: false,
      last_sync_status: "success",
      last_sync_error: null,
      last_sync_warning: warnings.length ? warnings.join(" | ").slice(0, 1000) : null,
      last_sync_at: new Date().toISOString(),
      last_sync_duration_ms: Date.now() - startTs,
      leads_count: totalLeadsCount ?? counts.leads ?? 0,
    }, { onConflict: "workspace_id" });

    // Avança os watermarks — só das entidades que concluíram sem erro (senão pularíamos
    // linhas para sempre). Leads/contacts lançam em erro (cairia no catch), então aqui
    // já concluíram; events/tasks são resilientes, condicionados ao seu *Error.
    const wmUpdate: Record<string, unknown> = {
      workspace_id: workspaceId,
      leads_last_seen_at: newWatermark,
      contacts_last_seen_at: newWatermark,
      last_run_at: new Date().toISOString(),
      last_run_status: "success",
      last_run_error: null,
      last_run_count: counts.leads ?? 0,
    };
    if (!stageEventsError) wmUpdate.events_last_seen_at = newWatermark;
    if (!tasksError) wmUpdate.tasks_last_seen_at = newWatermark;
    await db.from("sync_watermarks").upsert(wmUpdate, { onConflict: "workspace_id" });

    return new Response(
      JSON.stringify({ success: true, workspace_id: workspaceId, counts, warnings, stage_events_error: stageEventsError, tasks_error: tasksError, duration_ms: Date.now() - startTs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = serializeErr(e);
    console.error("kommo-sync error:", msg);
    // Erro de autorização → 403 limpo, sem sujar o sync_status (não foi uma
    // sincronização que falhou; foi um chamador sem permissão).
    const isAuthErr = msg === "Forbidden" || msg === "Missing authorization"
      || msg.startsWith("Forbidden");
    const status = isAuthErr ? 403 : 500;
    if (workspaceId && !isAuthErr) {
      // try/await em vez de `.catch()` no builder do PostgREST (que é PromiseLike
      // e pode não expor `.catch`, disparando um 2º erro dentro do catch).
      try {
        await db.from("sync_status").upsert({
          workspace_id: workspaceId, is_running: false, last_sync_status: "error", last_sync_error: msg.slice(0, 1000),
        }, { onConflict: "workspace_id" });
      } catch { /* ignora falha ao registrar o erro */ }
      await notifySyncFailure(workspaceId, msg);
    }
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// Aviso best-effort de falha real de sync (não dispara em erro de autorização —
// isso é chamador sem permissão, não uma sincronização quebrada). Reusa o mesmo
// webhook n8n que o frontend já usa em errorReporter.ts; nunca lança.
async function notifySyncFailure(workspaceId: string, message: string): Promise<void> {
  const webhookUrl = Deno.env.get("ERROR_WEBHOOK_URL") || "https://n8n-webhook.boliqf.easypanel.host/webhook/erro-lovable";
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "VFlowKommo",
        level: "error",
        source: "edge:kommo-sync",
        message: `Sync do Kommo falhou (workspace ${workspaceId}): ${message}`,
        workspace_id: workspaceId,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // nunca deixa a notificação derrubar a resposta do sync
  }
}

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
