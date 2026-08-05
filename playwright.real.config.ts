import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

// Loader manual (sem depender do pacote dotenv) — só pra esse arquivo de env
// dedicado, que o Vite não carrega sozinho (não bate no padrão .env[.mode]).
function loadEnvFile(path: string) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(".env.e2e-real");

// Config SEPARADA da suíte E2E mockada (playwright.config.ts). Essa aqui sobe o
// app apontando pro Supabase REAL (projeto Kommo isolado, fjncmmqvmocwykpshgsh) —
// só existe pra rodar tests-real/, nunca ./tests (que tem o guard-rail do host
// stub). Porta diferente (8091) pra nunca colidir com a suíte mockada.
const PORT = 8091;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests-real",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on",
    screenshot: "on",
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: process.env.E2E_REAL_SUPABASE_URL || "",
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.E2E_REAL_SUPABASE_KEY || "",
    },
  },
});
