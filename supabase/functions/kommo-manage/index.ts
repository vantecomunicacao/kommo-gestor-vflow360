// VFlow360 Kommo — kommo-manage
// Gerencia a integração Kommo por workspace: connect (valida + guarda token no Vault),
// status, disconnect. Schema `kommo`, isolado. Token NUNCA fica em texto puro: vai
// para o Vault via kommo.set_integration_token (RPC service_role).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KommoCreds, normalizeSubdomain, kommoFetch, kommoFetchAll } from "../_shared/kommo-client.ts";
import { resolveCallerIdentity, requireWorkspaceMember } from "../_shared/authorize.ts";
import { corsHeadersExtended as corsHeaders } from "../_shared/cors.ts";

interface KommoAccount {
  id?: string | number;
  name?: string;
  currency?: string;
}

interface KommoCustomFieldEnum {
  value?: string;
}

interface KommoCustomFieldRaw {
  id: string | number;
  name?: string;
  code?: string;
  type?: string;
  enums?: Array<string | KommoCustomFieldEnum>;
}

interface KommoPipelineStatusRaw {
  id: string | number;
  name: string;
}

interface KommoPipelineRaw {
  id: string | number;
  name?: string;
  _embedded?: { statuses?: KommoPipelineStatusRaw[] };
}

function serializeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (o.message) return [o.message, o.code, o.details, o.hint].filter(Boolean).join(" | ");
    try { return JSON.stringify(o); } catch { return String(e); }
  }
  return String(e);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "kommo" } });

  try {
    // Identidade do chamador — SEM checar workspace ainda, porque "connect" sem
    // workspace_id cria um workspace novo (não há membership pra checar até existir).
    const { userId } = await resolveCallerIdentity(req, SUPABASE_URL, ANON_KEY);
    if (!userId) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = (body.action as string) || "status";
    let workspaceId = body.workspace_id as string | null;

    const requireMember = (wsId: string) => requireWorkspaceMember(db, userId, wsId);

    // Apaga todo o dado de CRM sincronizado de um workspace (modelo "uma conta por vez").
    // Usado quando se conecta uma conta Kommo DIFERENTE da anterior, para não misturar dados.
    // Seguro pra reexecutar: cada DELETE é idempotente (0 linhas se já limpo), e o
    // account_id da integração só é atualizado DEPOIS que isto termina sem erro — se
    // falhar no meio, o próximo "connect" com as mesmas credenciais detecta a troca de
    // conta de novo e retoma a limpeza (sem duplicar trabalho nem perder o rastro).
    const wipeWorkspaceData = async (wsId: string) => {
      const tables = [
        "leads", "contacts", "pipelines", "users",
        "loss_reasons", "custom_fields", "sync_status", "sync_watermarks",
      ];
      for (const t of tables) {
        const { error } = await db.from(t).delete().eq("workspace_id", wsId);
        if (error) throw new Error(`Falha ao limpar ${t}: ${error.message}`);
      }
    };

    // Carrega credenciais Kommo (subdomínio + token do Vault) da integração conectada do workspace.
    const loadCreds = async (wsId: string): Promise<KommoCreds> => {
      const { data: intg } = await db.from("integrations")
        .select("id,subdomain,status").eq("workspace_id", wsId).eq("type", "kommo").maybeSingle();
      if (!intg || intg.status !== "connected") throw new Error("Kommo não conectado neste workspace");
      const { data: tok, error: tErr } = await db.rpc("get_integration_token", { p_integration_id: intg.id });
      if (tErr) throw tErr;
      if (!tok) throw new Error("Token Kommo não encontrado no Vault");
      return { subdomain: intg.subdomain as string, token: tok as string };
    };

    // ---------- CONNECT ----------
    if (action === "connect") {
      const subdomain = normalizeSubdomain((body.subdomain as string) || "");
      const kommoToken = (body.token as string) || "";
      if (!subdomain || !kommoToken) throw new Error("Informe subdomínio e token");

      // 1) valida credenciais no Kommo
      const creds: KommoCreds = { subdomain, token: kommoToken };
      let account: KommoAccount | undefined;
      try {
        account = await kommoFetch(creds, "/account");
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: "Credenciais Kommo inválidas: " + serializeErr(e) }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2) resolve workspace (usa o passado, ou cria um novo do usuário)
      if (workspaceId) {
        await requireMember(workspaceId);
      } else {
        const { data: ws, error: wErr } = await db.from("workspaces")
          .insert({ name: account?.name || "Conta Kommo", owner_id: userId }).select("id").single();
        if (wErr) throw wErr;
        workspaceId = ws.id;
        await db.from("workspace_members").upsert(
          { workspace_id: workspaceId, user_id: userId, role: "owner" },
          { onConflict: "workspace_id,user_id" },
        );
      }
      // ws.id vem de um client sem tipos gerados (any) — narrowing explícito em vez
      // de assumir que a criação do workspace sempre devolve um id válido.
      if (!workspaceId) throw new Error("Falha ao resolver workspace_id");

      // 3) upsert da integração (sem token em claro)
      const newAccountId = String(account?.id ?? "");
      const { data: existing } = await db.from("integrations")
        .select("id,account_id").eq("workspace_id", workspaceId).eq("type", "kommo").maybeSingle();
      let integrationId: string;
      if (existing?.id) {
        // Conta mudou? "Uma conta por vez": limpa os dados da conta anterior antes de re-sincronizar.
        if (existing.account_id && newAccountId && existing.account_id !== newAccountId) {
          await wipeWorkspaceData(workspaceId);
        }
        integrationId = existing.id;
        const { error } = await db.from("integrations").update({
          user_id: userId, subdomain, account_id: newAccountId, status: "connected",
        }).eq("id", integrationId);
        if (error) throw error;
      } else {
        const { data: ins, error } = await db.from("integrations").insert({
          user_id: userId, workspace_id: workspaceId, type: "kommo",
          subdomain, account_id: newAccountId, status: "connected",
        }).select("id").single();
        if (error) throw error;
        integrationId = ins.id;
      }

      // 4) guarda o token cifrado no Vault
      const { error: vErr } = await db.rpc("set_integration_token", { p_integration_id: integrationId, p_token: kommoToken });
      if (vErr) throw vErr;

      return new Response(JSON.stringify({
        success: true, workspace_id: workspaceId, integration_id: integrationId,
        account: { id: account?.id, name: account?.name, currency: account?.currency },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- STATUS ----------
    if (action === "status") {
      if (!workspaceId) throw new Error("workspace_id is required");
      await requireMember(workspaceId);
      const { data: intg } = await db.from("integrations")
        .select("id,subdomain,account_id,status,updated_at").eq("workspace_id", workspaceId).eq("type", "kommo").maybeSingle();
      const { data: sync } = await db.from("sync_status")
        .select("last_sync_at,last_sync_status,last_sync_error,last_sync_warning,leads_count").eq("workspace_id", workspaceId).maybeSingle();
      return new Response(JSON.stringify({
        success: true,
        connected: intg?.status === "connected",
        subdomain: intg?.subdomain ?? null,
        account_id: intg?.account_id ?? null,
        status: intg?.status ?? "disconnected",
        sync: sync ?? null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- DISCONNECT ----------
    if (action === "disconnect") {
      if (!workspaceId) throw new Error("workspace_id is required");
      await requireMember(workspaceId);
      await db.from("integrations").update({ status: "disconnected" })
        .eq("workspace_id", workspaceId).eq("type", "kommo");
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- CUSTOM_FIELDS ----------
    // Campos personalizados de leads + contatos, normalizados para a UI.
    if (action === "custom_fields") {
      if (!workspaceId) throw new Error("workspace_id is required");
      await requireMember(workspaceId);
      const creds = await loadCreds(workspaceId);
      const [cfLeads, cfContacts] = await Promise.all([
        kommoFetchAll(creds, "/leads/custom_fields", "custom_fields", { maxPages: 10 }),
        kommoFetchAll(creds, "/contacts/custom_fields", "custom_fields", { maxPages: 10 }),
      ]);
      const mapField = (f: KommoCustomFieldRaw, entity: "lead" | "contact") => {
        const enums = Array.isArray(f?.enums) ? f.enums : [];
        const options = enums
          .map((e) => (typeof e === "string" ? e : e?.value))
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .map((value) => ({ value, instruction: "" }));
        return {
          id: `${entity}_${f.id}`,
          name: f.name || f.code || String(f.id),
          fieldKey: f.code || String(f.id),
          dataType: f.type || "text",
          selected: false,
          description: "",
          options: options.length > 0 ? options : undefined,
          entity,
        };
      };
      const customFields = [
        ...(cfLeads as KommoCustomFieldRaw[]).map((f) => mapField(f, "lead")),
        ...(cfContacts as KommoCustomFieldRaw[]).map((f) => mapField(f, "contact")),
      ];
      return new Response(JSON.stringify({ success: true, data: { customFields } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- PIPELINES ----------
    // Funis + etapas (statuses) achatados, normalizados para a UI.
    if (action === "pipelines") {
      if (!workspaceId) throw new Error("workspace_id is required");
      await requireMember(workspaceId);
      const creds = await loadCreds(workspaceId);
      const pipelines = await kommoFetchAll(creds, "/leads/pipelines", "pipelines", { maxPages: 10 }) as KommoPipelineRaw[];
      const normalized = pipelines.map((p) => ({
        id: String(p.id),
        name: p.name,
        stages: (p?._embedded?.statuses ?? []).map((s) => ({ id: String(s.id), name: s.name })),
      }));
      return new Response(JSON.stringify({ success: true, data: { pipelines: normalized } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- GET_MAPPINGS ----------
    if (action === "get_mappings") {
      if (!workspaceId) throw new Error("workspace_id is required");
      await requireMember(workspaceId);
      const { data: intg } = await db.from("integrations")
        .select("config").eq("workspace_id", workspaceId).eq("type", "kommo").maybeSingle();
      const config = (intg?.config ?? {}) as Record<string, unknown>;
      return new Response(JSON.stringify({
        success: true,
        data: {
          selectedFields: config.selectedFields || [],
          selectedStages: config.selectedStages || [],
          aiPrompt: config.aiPrompt || "",
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- SAVE_MAPPINGS ----------
    if (action === "save_mappings") {
      if (!workspaceId) throw new Error("workspace_id is required");
      await requireMember(workspaceId);
      const selectedFields = Array.isArray(body.selectedFields) ? body.selectedFields : [];
      const selectedStages = Array.isArray(body.selectedStages) ? body.selectedStages : [];
      const aiPrompt = typeof body.aiPrompt === "string" ? body.aiPrompt : "";
      const { data: intg } = await db.from("integrations")
        .select("id,config").eq("workspace_id", workspaceId).eq("type", "kommo").maybeSingle();
      if (!intg?.id) throw new Error("Kommo não conectado neste workspace");
      const currentConfig = (intg.config ?? {}) as Record<string, unknown>;
      const { error } = await db.from("integrations").update({
        config: { ...currentConfig, selectedFields, selectedStages, aiPrompt },
      }).eq("id", intg.id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error("Ação desconhecida: " + action);
  } catch (e) {
    const msg = serializeErr(e);
    console.error("kommo-manage error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
