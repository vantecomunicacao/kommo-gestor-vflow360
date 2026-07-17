// VFlow360 Kommo — kommo-actions
// Ações de ESCRITA no Kommo a partir do app (ex.: a partir dos "leads esfriando"):
//   - kind "task": cria uma tarefa no lead (cai na agenda do responsável).
//   - kind "tag":  aplica uma tag no lead (preservando as tags existentes).
// Schema `kommo`, isolado — NÃO toca em public.*/ghl_*. Token SEMPRE do Vault por workspace.
// Espelha o esqueleto de auth + loadCreds do kommo-manage. Nunca edge→edge; usa kommoFetch inline.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KommoCreds, kommoFetch } from "../_shared/kommo-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_TAG = "esfriando";
const DEFAULT_TASK_TYPE_ID = 1; // "Contato" (tipo padrão do Kommo)

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const token = authHeader.replace("Bearer ", "");

    // Auth: exige usuário válido no JWT + membership no workspace.
    // getClaims em try/catch (não derruba com 500 nas API keys novas), mas o
    // usuário é OBRIGATÓRIO — sem usuário, 401; sem membership, 403.
    let userId: string | null = null;
    try {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: claims } = await userClient.auth.getClaims(token);
      userId = claims?.claims?.sub ?? null;
    } catch { userId = null; }
    if (!userId) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({} as any));
    const workspaceId = body.workspace_id as string;
    const leadKommoId = String(body.lead_kommo_id ?? "");
    const kind = (body.kind as string) || "task";
    if (!workspaceId) throw new Error("workspace_id is required");
    if (!leadKommoId) throw new Error("lead_kommo_id is required");

    const { data: isMember } = await db.rpc("is_workspace_member", {
      _user_id: userId, _workspace_id: workspaceId,
    });
    if (!isMember) throw new Error("Forbidden: not a member of this workspace");

    // Idempotência: se o vflow já criou esta ação neste lead, não repete no Kommo.
    const { data: prior } = await db.from("lead_actions")
      .select("id").eq("workspace_id", workspaceId).eq("lead_kommo_id", leadKommoId).eq("kind", kind).maybeSingle();
    if (prior) {
      return new Response(JSON.stringify({ success: true, kind, alreadyDone: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Registra a ação (best-effort; conflito = já registrado por outra requisição).
    const recordAction = async () => {
      await db.from("lead_actions")
        .upsert({ workspace_id: workspaceId, lead_kommo_id: leadKommoId, kind, created_by: userId ?? null },
          { onConflict: "workspace_id,lead_kommo_id,kind", ignoreDuplicates: true });
    };

    // Credenciais Kommo (subdomínio + token do Vault) da integração conectada do workspace.
    const { data: intg } = await db.from("integrations")
      .select("id,subdomain,status").eq("workspace_id", workspaceId).eq("type", "kommo").maybeSingle();
    if (!intg || (intg as any).status !== "connected") throw new Error("Kommo não conectado neste workspace");
    const { data: tok, error: tErr } = await db.rpc("get_integration_token", { p_integration_id: (intg as any).id });
    if (tErr) throw tErr;
    if (!tok) throw new Error("Token Kommo não encontrado no Vault");
    const creds: KommoCreds = { subdomain: (intg as any).subdomain as string, token: tok as string };

    if (kind === "task") {
      // Responsável: usa o do payload; se ausente, lê o do lead no Kommo.
      let responsibleUserId = body.responsible_user_id ? Number(body.responsible_user_id) : null;
      if (!responsibleUserId) {
        const lead = await kommoFetch(creds, `/leads/${leadKommoId}`);
        if (lead?.responsible_user_id) responsibleUserId = Number(lead.responsible_user_id);
      }
      const days = Number(body.days ?? 0);
      const text = (body.text as string) ||
        (days > 0 ? `🔴 Lead esfriando há ${days} dias — retomar contato` : "🔴 Lead esfriando — retomar contato");
      // Prazo: amanhã 18h (horário do servidor), em unix segundos.
      const due = new Date();
      due.setDate(due.getDate() + 1);
      due.setHours(18, 0, 0, 0);
      const completeTill = Math.floor(due.getTime() / 1000);

      const taskPayload: Record<string, unknown> = {
        text,
        complete_till: completeTill,
        entity_id: Number(leadKommoId),
        entity_type: "leads",
        task_type_id: DEFAULT_TASK_TYPE_ID,
      };
      if (responsibleUserId) taskPayload.responsible_user_id = responsibleUserId;

      await kommoFetch(creds, "/tasks", { method: "POST", body: JSON.stringify([taskPayload]) });
      await recordAction();
      return new Response(JSON.stringify({ success: true, kind: "task" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (kind === "tag") {
      const tagName = ((body.tag as string) || DEFAULT_TAG).trim();
      // O PATCH do Kommo SUBSTITUI o array de tags. Lemos as atuais e mandamos a união
      // para não apagar o que já existe no lead.
      const lead = await kommoFetch(creds, `/leads/${leadKommoId}?with=tags`);
      const current: any[] = lead?._embedded?.tags ?? [];
      const already = current.some((t) => String(t?.name || "").toLowerCase() === tagName.toLowerCase());
      if (already) {
        await recordAction();
        return new Response(JSON.stringify({ success: true, kind: "tag", alreadyTagged: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Preserva as existentes (por id quando houver) e adiciona a nova por nome.
      const tags = [
        ...current.map((t) => (t?.id ? { id: t.id } : { name: t.name })),
        { name: tagName },
      ];
      await kommoFetch(creds, `/leads/${leadKommoId}`, {
        method: "PATCH",
        body: JSON.stringify({ _embedded: { tags } }),
      });
      await recordAction();
      return new Response(JSON.stringify({ success: true, kind: "tag" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Ação desconhecida: ${kind}`);
  } catch (err) {
    const msg = serializeErr(err);
    console.error("kommo-actions error:", msg);
    const status = /unauthorized|missing authorization/i.test(msg) ? 401
      : /forbidden/i.test(msg) ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
