import { test, expect } from "@playwright/test";
import { installSupabaseMocks, loginAs } from "./helpers/supabaseMock";

test.describe("Autenticação e guards de papel", () => {
  test("rota protegida sem login redireciona para /login", async ({ page }) => {
    await installSupabaseMocks(page, { role: "gestor" });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: /bem-vindo de volta/i })).toBeVisible();
  });

  test("login do gestor cai no Dashboard e mostra a navegação completa", async ({ page }) => {
    await installSupabaseMocks(page, { role: "gestor" });
    await loginAs(page, "gestor");

    await expect(page).toHaveURL(/\/dashboard$/);
    // Sidebar de gestor: itens exclusivos visíveis
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Integrações" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  });

  // Fase 1 (Kommo, analytics): a página de Sugestões saiu do produto. O perfil
  // "só sugestões" (vendedor) agora cai em /leads-esfriando (Leads esfriando), a única
  // página que ele enxerga. Ver docs/ROADMAP_FASE2_COPILOTO.md.
  test("login do vendedor cai em /leads-esfriando e esconde rotas de gestor", async ({ page }) => {
    await installSupabaseMocks(page, { role: "vendedor" });
    await loginAs(page, "vendedor");

    await expect(page).toHaveURL(/\/leads-esfriando$/);
    await expect(page.getByRole("link", { name: "Leads esfriando" })).toBeVisible();
    // Itens de gestor NÃO aparecem para vendedor
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Integrações" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });

  test("vendedor é bloqueado em /dashboard (PermissionGuard) e volta para /leads-esfriando", async ({ page }) => {
    await installSupabaseMocks(page, { role: "vendedor" });
    await loginAs(page, "vendedor");

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/leads-esfriando$/);
  });

  test("vendedor é bloqueado em /integrations (PermissionGuard) e volta para /leads-esfriando", async ({ page }) => {
    await installSupabaseMocks(page, { role: "vendedor" });
    await loginAs(page, "vendedor");

    await page.goto("/integrations");
    await expect(page).toHaveURL(/\/leads-esfriando$/);
  });

  test("credenciais inválidas mostram toast de erro e permanecem no /login", async ({ page }) => {
    await installSupabaseMocks(page, { role: "gestor", badLogin: true });
    await page.goto("/login");
    await page.getByLabel("Email").fill("errado@vflow360.test");
    await page.getByLabel("Senha").fill("senha-errada");
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.getByText(/erro ao entrar/i)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  // Regressao: F5 (reload completo) numa rota protegida por PermissionGuard nao
  // pode chutar o usuario para /dashboard durante a transicao user=null->presente.
  test("reload do gestor em /integrations permanece em /integrations", async ({ page }) => {
    await installSupabaseMocks(page, { role: "gestor" });
    await loginAs(page, "gestor");

    await page.goto("/integrations");
    await expect(page).toHaveURL(/\/integrations$/);
    await expect(page.getByRole("heading", { name: /integrações/i })).toBeVisible();
  });

  test("reload do vendedor em /leads-esfriando permanece em /leads-esfriando", async ({ page }) => {
    await installSupabaseMocks(page, { role: "vendedor" });
    await loginAs(page, "vendedor");

    await page.goto("/leads-esfriando");
    await expect(page).toHaveURL(/\/leads-esfriando$/);
    await expect(page.getByRole("link", { name: "Leads esfriando" })).toBeVisible();
  });

  test("logout retorna para a tela de login", async ({ page }) => {
    await installSupabaseMocks(page, { role: "gestor" });
    await loginAs(page, "gestor");

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
