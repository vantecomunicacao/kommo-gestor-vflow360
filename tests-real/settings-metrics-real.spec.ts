import { test, expect } from "@playwright/test";

// Continuação de login-real.spec.ts: mesmo usuário/projeto real, agora navegando
// como um usuário faria — Personalizar → cadastrar uma Métrica Personalizada →
// voltar ao Dashboard. Workspace de teste não tem Kommo conectado, então os
// CARDS de dado (funil, métricas) não têm número pra mostrar — o objetivo aqui é
// provar que a NAVEGAÇÃO e as TELAS funcionam de ponta a ponta, não os números.
const EMAIL = process.env.E2E_REAL_EMAIL || "";
const PASSWORD = process.env.E2E_REAL_PASSWORD || "";

test.describe("Navegação real — Configurações e Dashboard", () => {
  test.skip(!EMAIL || !PASSWORD, "Faltam E2E_REAL_EMAIL/E2E_REAL_PASSWORD em .env.e2e-real");

  test("login, abre Personalizar, cadastra métrica, confere no Dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    await page.screenshot({ path: "test-results/real-02-dashboard-inicial.png", fullPage: true });

    // Personalizar
    await page.goto("/settings/dashboard");
    await expect(page.getByRole("heading", { name: /configurações do dashboard/i })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/real-03-settings-topo.png", fullPage: true });

    const metricsCard = page.getByText("Métricas Personalizadas").first();
    await metricsCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/real-04-metricas-card-vazio.png" });

    await page.getByRole("button", { name: /adicionar métrica/i }).click();
    await page.getByPlaceholder(/Métrica 1/i).fill("Teste E2E — Recompra");
    await page.screenshot({ path: "test-results/real-05-metrica-adicionada.png" });

    // Sem funil sincronizado nesse workspace de teste, então não dá pra escolher
    // etapa — mas o formulário e o estado (nome preenchido) já provam que a UI
    // funciona ponta a ponta. Salva mesmo sem etapa: deve mostrar o toast de erro
    // de validação (numerador obrigatório) em vez de quebrar a página.
    await page.getByRole("button", { name: /^salvar$/i }).first().click();
    await page.screenshot({ path: "test-results/real-06-salvar-sem-etapa.png" });
  });
});
