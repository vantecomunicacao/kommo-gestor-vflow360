// Guardrail (Fase 1c do plano de remediação, 2026-08-05): toda edge function
// com `verify_jwt = false` no config.toml assume auth 100% manual (a
// plataforma não barra nada antes da função rodar — ver _shared/authorize.ts).
// Este script falha a CI se uma dessas functions não tiver NENHUM sinal de
// checagem de autorização nem um comentário explícito marcando o endpoint
// como intencionalmente público (ex.: log-event).
//
// Versão "fraca" de propósito: não exige authorizeWorkspace especificamente,
// porque kommo-manage e cooling-leads têm checagem manual válida mas
// estruturalmente diferente. Decisão de uniformizar fica pra Fase 3(a).
//
// Funções GHL/legadas (Regra #1 do CLAUDE.md) são ignoradas — não é
// responsabilidade do Kommo endurecer ou revisar esse código.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const configPath = path.join(repoRoot, "supabase", "config.toml");
const config = readFileSync(configPath, "utf8");

const ghlAndLegacy = new Set([
  "admin-bootstrap", "admin-users", "ai-analyze-v2", "ai-assistant",
  "ai-insights-generate", "ghl-conversations-sync", "ghl-dashboard",
  "ghl-enrich-attachments", "ghl-manage", "ghl-messages-sync", "ghl-sync",
]);

const authSignal = /authorizeWorkspace|is_workspace_member|x-internal-secret|getClaims|getUser|Public endpoint/i;

const jwtDisabled = [...config.matchAll(/\[functions\.([\w-]+)\]\s*\n\s*verify_jwt\s*=\s*false/g)]
  .map((m) => m[1])
  .filter((name) => !ghlAndLegacy.has(name));

const failures = [];

for (const name of jwtDisabled) {
  const entrypoint = path.join(repoRoot, "supabase", "functions", name, "index.ts");
  if (!existsSync(entrypoint)) {
    failures.push(`${name}: verify_jwt=false no config.toml mas supabase/functions/${name}/index.ts não existe`);
    continue;
  }
  const src = readFileSync(entrypoint, "utf8");
  if (!authSignal.test(src)) {
    failures.push(
      `${name}: verify_jwt=false e nenhum sinal de autorização encontrado em index.ts ` +
      `(esperado: authorizeWorkspace, is_workspace_member, x-internal-secret, getClaims/getUser, ` +
      `ou comentário "Public endpoint" se for intencionalmente aberto)`,
    );
  }
}

if (failures.length > 0) {
  console.error("Guardrail de auth falhou:\n");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\n${failures.length} function(s) com verify_jwt=false sem autorização visível.`);
  process.exit(1);
}

console.log(`Guardrail de auth OK — ${jwtDisabled.length} function(s) com verify_jwt=false, todas com sinal de autorização (ou marcadas públicas).`);
