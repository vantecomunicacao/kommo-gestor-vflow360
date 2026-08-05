import { test, expect } from "@playwright/test";

// Teste REAL — bate direto no Supabase de produção (projeto Kommo isolado,
// fjncmmqvmocwykpshgsh), sem mock de rede. Roda só via `npm run test:e2e:real`
// (playwright.real.config.ts), nunca pela suíte padrão (tests/, com o guard-rail
// do host stub em playwright.config.ts).
//
// Usuário: e2e-test@vflow360.internal — conta dedicada, sem dado de cliente real,
// workspace próprio "E2E Teste (nao usar - dados ficticios)". Credenciais em
// .env.e2e-real (git-ignorado, nunca comitar).
const EMAIL = process.env.E2E_REAL_EMAIL || "";
const PASSWORD = process.env.E2E_REAL_PASSWORD || "";

test.describe("Login real (Supabase de produção)", () => {
  test.skip(!EMAIL || !PASSWORD, "Faltam E2E_REAL_EMAIL/E2E_REAL_PASSWORD em .env.e2e-real");

  test("usuário de teste digita email/senha reais e entra no Dashboard", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /bem-vindo de volta/i })).toBeVisible();

    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.screenshot({ path: "test-results/real-login-01-preenchido.png" });

    await page.getByRole("button", { name: /entrar/i }).click();

    // Sessão real do Supabase Auth — sem mock, o redirect só acontece se o
    // backend de fato validou email+senha.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    await page.screenshot({ path: "test-results/real-login-02-dashboard.png" });
  });
});
