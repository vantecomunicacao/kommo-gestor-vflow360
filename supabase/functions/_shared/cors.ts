// Headers CORS compartilhados das edge functions Kommo.
//
// Duas variantes reais (achado na Fase 3 do plano de remediação, 2026-08):
// não eram um único padrão duplicado, e sim 3 combinações diferentes. `kommo-sync`
// tem uma terceira (própria, com `x-internal-secret`) e continua definida localmente
// lá — é o único consumidor, então não há nada para desduplicar.

const BASE_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const EXTENDED_ALLOW_HEADERS =
  `${BASE_ALLOW_HEADERS}, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version`;

/** kommo-admin-bootstrap, kommo-admin-users, log-event. */
export const corsHeadersBase = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": BASE_ALLOW_HEADERS,
};

/** kommo-actions, kommo-ai-analyze, kommo-manage, kommo-report-snapshot, cooling-leads, kommo-dashboard. */
export const corsHeadersExtended = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": EXTENDED_ALLOW_HEADERS,
};
