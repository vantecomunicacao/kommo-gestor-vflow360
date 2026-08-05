import { test, expect } from "@playwright/test";
import { installSupabaseMocks, loginAs } from "./helpers/supabaseMock";

// Smoke de navegação como gestor. Cada rota é um teste independente: login +
// um clique no link da sidebar (roteamento client-side, o fluxo real). Evita
// tanto a corrida de permissões do reload (page.goto em rota protegida) quanto
// a instabilidade de encadear muitos cliques sobre chunks lazy numa só sessão.

// Fase 1 (Kommo, analytics): menu enxuto. Copiloto de IA (Conversas/Sugestões/
// Analista) e observabilidade (Logs/Sistema) saíram do produto — ver
// docs/ROADMAP_FASE2_COPILOTO.md.
const routes: { link: string; exact?: boolean; url: RegExp }[] = [
  { link: "Leads esfriando", url: /\/leads-esfriando$/ },
  { link: "Integrações", url: /\/integrations$/ },
  { link: "Admin", exact: true, url: /\/admin$/ },
  { link: "Configurações", url: /\/settings\/account$/ },
];

test.describe("Navegação smoke (gestor)", () => {
  for (const { link, exact, url } of routes) {
    test(`sidebar → ${link}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await installSupabaseMocks(page, { role: "gestor" });
      await loginAs(page, "gestor");

      await page.getByRole("link", { name: link, exact }).click();
      await expect(page).toHaveURL(url);
      // shell autenticado segue de pé
      await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();

      expect(pageErrors, `exceções em ${link}:\n${pageErrors.join("\n")}`).toEqual([]);
    });
  }

  test("as abas de Configurações trocam de sub-rota", async ({ page }) => {
    await installSupabaseMocks(page, { role: "gestor" });
    await loginAs(page, "gestor");

    await page.getByRole("link", { name: "Configurações" }).click();
    await expect(page).toHaveURL(/\/settings\/account$/);

    // Sub-abas são links com href fixo (desambígua de itens da sidebar)
    for (const sub of ["workspace", "ai", "dashboard"]) {
      await page.locator(`a[href="/settings/${sub}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/settings/${sub}$`));
    }
  });
});
