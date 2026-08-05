import type { Page, Route } from "@playwright/test";
import {
  Role,
  edgeResult,
  rpcResult,
  sessionFor,
  tableRows,
  userFor,
} from "./fixtures";

// ---------------------------------------------------------------------------
// Mock de rede do Supabase.
//
// Por que existe: o backend deste projeto é o ambiente VIVO de produção
// (centenas de msgs/dia). Os E2E NÃO podem tocá-lo. Aqui interceptamos TODA
// chamada de rede do supabase-js (auth, REST, RPC, edge functions, realtime)
// e devolvemos respostas fixas. Combinado com o host stub do playwright.config,
// qualquer request não previsto morre num host inexistente — nunca em produção.
// ---------------------------------------------------------------------------

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-allow-headers":
    "authorization,apikey,content-type,accept,accept-profile,content-profile,prefer,x-client-info,x-supabase-api-version,range",
  "access-control-expose-headers": "content-range,content-profile",
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: { ...CORS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// PostgREST devolve objeto único (não array) quando o cliente pediu .single()
function wantsSingleObject(route: Route): boolean {
  const accept = route.request().headers()["accept"] ?? "";
  return accept.includes("vnd.pgrst.object");
}

// Wrapper que responde o preflight OPTIONS automaticamente e delega o resto.
async function intercept(
  page: Page,
  glob: string,
  handler: (route: Route) => unknown,
) {
  await page.route(glob, (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS, body: "" });
    }
    return handler(route);
  });
}

export interface MockOptions {
  role: Role;
  /** força credenciais inválidas no login (para testar o toast de erro) */
  badLogin?: boolean;
}

export async function installSupabaseMocks(page: Page, opts: MockOptions) {
  const { role } = opts;

  // 0. Realtime: não conectar a lugar nenhum (evita ws pendurado e ruído).
  await page.routeWebSocket(/realtime\/v1/, () => {
    /* deixa o socket aberto e mudo; o app não depende dele para os fluxos testados */
  });

  // 1. Fallback amplo: qualquer coisa no host stub que não casar abaixo -> [].
  //    (registrado primeiro = menor prioridade no Playwright)
  await intercept(page, "**/stub.supabase.co/**", (route) => json(route, []));

  // 2. Auth
  await intercept(page, "**/auth/v1/token**", (route) => {
    if (opts.badLogin) {
      return json(
        route,
        { error: "invalid_grant", error_description: "Invalid login credentials" },
        400,
      );
    }
    return json(route, sessionFor(role));
  });
  await intercept(page, "**/auth/v1/user**", (route) => json(route, userFor(role)));
  await intercept(page, "**/auth/v1/logout**", (route) =>
    route.fulfill({ status: 204, headers: CORS, body: "" }),
  );

  // 3. REST + RPC (PostgREST)
  await intercept(page, "**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    const seg = url.pathname.split("/rest/v1/")[1] ?? "";

    if (seg.startsWith("rpc/")) {
      const fn = seg.slice(4).split("?")[0];
      return json(route, rpcResult(fn, role));
    }

    const table = seg.split("?")[0];
    const method = route.request().method();

    // Mutações: ecoa OK (devolve o que o PostgREST devolveria com Prefer: return).
    if (method === "PATCH" || method === "POST" || method === "DELETE" || method === "PUT") {
      const rows = tableRows(table);
      return wantsSingleObject(route) ? json(route, rows[0] ?? {}) : json(route, rows);
    }

    const rows = tableRows(table);
    return wantsSingleObject(route) ? json(route, rows[0] ?? {}) : json(route, rows);
  });

  // 4. Edge functions
  await intercept(page, "**/functions/v1/**", (route) => {
    const url = new URL(route.request().url());
    const fn = (url.pathname.split("/functions/v1/")[1] ?? "").split("?")[0];
    return json(route, edgeResult(fn));
  });
}

// Login pela UI usando os mocks. Espera o redirect conforme o perfil.
export async function loginAs(page: Page, role: Role) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@vflow360.test`);
  await page.getByLabel("Senha").fill("senha-de-teste");
  await page.getByRole("button", { name: /entrar/i }).click();
  // Fase 1 (Kommo): Sugestões saiu do produto; o vendedor ("só sugestões") cai em
  // /leads-esfriando. Ver docs/ROADMAP_FASE2_COPILOTO.md.
  await page.waitForURL(role === "vendedor" ? "**/leads-esfriando" : "**/dashboard");
}
