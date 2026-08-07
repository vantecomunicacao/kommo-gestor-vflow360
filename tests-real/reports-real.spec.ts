import { test, expect } from "@playwright/test";

// Verificacao pos-Fase 5 (extracao de reports-metrics.ts/Sparkline.tsx): confere
// que a pagina de Relatorios carrega sem erro de console apos o refactor.
// Workspace de teste sem Kommo conectado — nao valida numeros/graficos reais,
// so que a tela em si nao quebrou (import quebrado, referencia perdida etc.).
const EMAIL = process.env.E2E_REAL_EMAIL || "";
const PASSWORD = process.env.E2E_REAL_PASSWORD || "";

test.describe("Relatórios — pós Fase 5 (Supabase real)", () => {
  test.skip(!EMAIL || !PASSWORD, "Faltam E2E_REAL_EMAIL/E2E_REAL_PASSWORD em .env.e2e-real");

  test("carrega sem erro de console", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

    await page.getByRole("link", { name: "Relatórios" }).click();
    await expect(page).toHaveURL(/\/relatorios$/, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/reports-01-carregado.png", fullPage: true });

    expect(errors, `erros de console:\n${errors.join("\n")}`).toEqual([]);
  });
});
