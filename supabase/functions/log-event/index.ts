// Public endpoint that persists log entries from the frontend.
// JWT verification disabled — anyone can post a log; service role inserts.
//
// Guard leve (Fase 1.7 do plano de remediação): rate limit EM MEMÓRIA por IP +
// global por instância da função. Não persiste entre cold starts nem cobre
// instâncias paralelas, mas blinda o caso real (um script martelando o
// endpoint) sem migration nem tabela nova. O fluxo normal do frontend
// (errorReporter.ts, com dedupe de 10s) fica muito abaixo do teto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { corsHeadersBase as corsHeaders } from "../_shared/cors.ts";

const WINDOW_MS = 60_000;
const PER_IP_MAX = 60; // logs/min por IP
const GLOBAL_MAX = 600; // logs/min no total (por instância da função)

const ipHits = new Map<string, number[]>();
let globalHits: number[] = [];

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** true = estourou o teto (não deve gravar). Também registra o hit quando passa. */
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  globalHits = globalHits.filter((t) => t > cutoff);
  const mine = (ipHits.get(ip) ?? []).filter((t) => t > cutoff);

  if (globalHits.length >= GLOBAL_MAX || mine.length >= PER_IP_MAX) {
    ipHits.set(ip, mine);
    return true;
  }

  mine.push(now);
  globalHits.push(now);
  ipHits.set(ip, mine);

  // limpeza preguiçosa pra o Map não crescer sem limite
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) if (v.every((t) => t <= cutoff)) ipHits.delete(k);
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (rateLimited(clientIp(req))) {
      return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
