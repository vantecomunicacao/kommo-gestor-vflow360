// Centralized error reporter — sends errors to n8n webhook AND persists in DB.
import { toast } from "sonner";

// Webhook DEDICADO ao VFlowKommo (item 1.3 do plano de remediação). Sem
// VITE_ERROR_WEBHOOK_URL definido, o envio pro webhook é PULADO — nada de
// fallback pro endpoint compartilhado com lovable/GHL. O log em `system_logs`
// (LOG_EVENT_URL abaixo) continua sempre.
const WEBHOOK_URL = import.meta.env.VITE_ERROR_WEBHOOK_URL || "";
const LOG_EVENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-event`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const PROJECT = "VFlowKommo";

const CHUNK_LOAD_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /loading chunk \S+ failed/i,
  /chunkloaderror/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
];

function isChunkLoadError(message: string | undefined | null): boolean {
  if (!message) return false;
  return CHUNK_LOAD_PATTERNS.some((p) => p.test(message));
}

let staleVersionToastShown = false;

function notifyStaleVersion() {
  if (staleVersionToastShown) return;
  staleVersionToastShown = true;
  toast.info("Nova versão disponível", {
    description: "Atualize a página para carregar a versão mais recente.",
    duration: Infinity,
    action: {
      label: "Atualizar agora",
      onClick: () => window.location.reload(),
    },
    onDismiss: () => {
      staleVersionToastShown = false;
    },
  });
}

type ReportPayload = {
  level?: "error" | "warning" | "info";
  source: string; // e.g. "frontend:window.onerror", "frontend:react-query", "frontend:Suggestions"
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
};

const recentHashes = new Map<string, number>();
const DEDUPE_MS = 10_000;

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h);
}

export async function reportError(payload: ReportPayload): Promise<void> {
  try {
    const key = hash(`${payload.source}|${payload.message}`);
    const now = Date.now();
    const last = recentHashes.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recentHashes.set(key, now);

    const body = {
      project: PROJECT,
      env: import.meta.env.MODE,
      level: payload.level ?? "error",
      source: payload.source,
      message: payload.message,
      stack: payload.stack,
      context: payload.context ?? {},
      url: typeof window !== "undefined" ? window.location.href : undefined,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      timestamp: new Date().toISOString(),
    };

    // Fire-and-forget; never block UI on reporting. O webhook só é chamado se
    // VITE_ERROR_WEBHOOK_URL estiver definido (ver WEBHOOK_URL acima).
    await Promise.all([
      WEBHOOK_URL
        ? fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive: true,
          }).catch(() => {})
        : Promise.resolve(),
      fetch(LOG_EVENT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {}),
    ]);
  } catch {
    // Swallow — reporter must never throw.
  }
}

declare global {
  interface Window {
    __errorReporterInstalled?: boolean;
  }
}

export function installGlobalErrorReporter() {
  if (typeof window === "undefined") return;
  if (window.__errorReporterInstalled) return;
  window.__errorReporterInstalled = true;

  window.addEventListener("error", (event) => {
    const err = event.error as Error | undefined;
    const message = err?.message || event.message || "Unknown error";
    if (isChunkLoadError(message)) {
      notifyStaleVersion();
      return;
    }
    void reportError({
      source: "frontend:window.onerror",
      message,
      stack: err?.stack,
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string; stack?: string } | string | null;
    const message =
      typeof reason === "string"
        ? reason
        : (reason && typeof reason === "object" && reason.message)
          ? reason.message
          : JSON.stringify(reason ?? "unhandledrejection");
    if (isChunkLoadError(message)) {
      notifyStaleVersion();
      return;
    }
    void reportError({
      source: "frontend:unhandledrejection",
      message,
      stack: typeof reason === "object" && reason ? reason.stack : undefined,
    });
  });
}
