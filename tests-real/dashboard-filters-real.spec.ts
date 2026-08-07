import { test, expect } from "@playwright/test";

// Verificacao pos-Fase 5 (extracao do useDashboardFilterPersistence): confere
// que hidratacao (URL/localStorage/funil padrao), persistencia (URL+storage) e
// deep link continuam se comportando igual apos o refactor. Workspace de teste
// sem Kommo conectado (sem funil/dados reais) — nao valida NUMEROS, só que a
// mecanica de filtro (estado <-> URL <-> localStorage) nao quebrou.
const EMAIL = process.env.E2E_REAL_EMAIL || "";
const PASSWORD = process.env.E2E_REAL_PASSWORD || "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

test.describe("Dashboard — filtros pós Fase 5 (Supabase real)", () => {
  test.skip(!EMAIL || !PASSWORD, "Faltam E2E_REAL_EMAIL/E2E_REAL_PASSWORD em .env.e2e-real");

  test("carrega sem erro de console e a URL reflete os filtros default", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await login(page);
    // Dá tempo do efeito de hidratação/persistência rodar e reescrever a URL.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/filters-01-dashboard-inicial.png", fullPage: true });

    const url = new URL(page.url());
    // Sem deep link na entrada, o efeito de persistência ainda deve escrever
    // from/to (período default) na URL depois de hidratar.
    expect(url.searchParams.get("from")).toBeTruthy();
    expect(url.searchParams.get("to")).toBeTruthy();

    expect(errors, `erros de console:\n${errors.join("\n")}`).toEqual([]);
  });

  test("reload preserva os filtros (localStorage) e navegar com querystring pré-popula (deep link)", async ({ page, context }) => {
    await login(page);
    await page.waitForTimeout(1500);
    const urlBefore = new URL(page.url());
    const fromBefore = urlBefore.searchParams.get("from");
    expect(fromBefore).toBeTruthy();

    // Reload completo: hidratação deve ler o localStorage e reproduzir a mesma URL.
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const urlAfterReload = new URL(page.url());
    expect(urlAfterReload.searchParams.get("from")).toBe(fromBefore);
    await page.screenshot({ path: "test-results/filters-02-apos-reload.png", fullPage: true });

    // Deep link: nova aba com querystring de filtro deve vencer sobre o localStorage.
    const page2 = await context.newPage();
    const deepFrom = "2025-01-01";
    const deepTo = "2025-01-31";
    await page2.goto(`/dashboard?from=${deepFrom}&to=${deepTo}&axis=fechamento`);
    await expect(page2).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await page2.waitForTimeout(1500);
    const url2 = new URL(page2.url());
    expect(url2.searchParams.get("from")).toBe(deepFrom);
    expect(url2.searchParams.get("to")).toBe(deepTo);
    expect(url2.searchParams.get("axis")).toBe("fechamento");
    await page2.screenshot({ path: "test-results/filters-03-deep-link.png", fullPage: true });
    await page2.close();
  });
});
