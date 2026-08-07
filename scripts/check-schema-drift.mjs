// Anti-drift do schema `kommo` (Fase 0 do plano de remediação — pedido pela 2ª e
// 3ª revisão, depois de o CLAUDE.md ter divergido do banco real: a URL dos crons
// e 3 tabelas (kommo.tasks, dashboard_analyses, ai_provider_config) ficaram de
// fora do inventário documentado por um bom tempo antes de alguém notar).
//
// Compara o schema `kommo` DE VERDADE (via `supabase db query --linked`) contra
// o inventário declarado em scripts/kommo-schema-manifest.json — que por sua vez
// deve ser mantido em sincronia manual com a seção "Tabelas do Kommo" do
// CLAUDE.md. Não corrige nada sozinho; só aponta a divergência pra alguém decidir
// (documentar o achado, ou investigar se é uma mudança não intencional).
//
// Rodar manualmente (fora da CI de propósito — precisa de credenciais reais do
// projeto Supabase, mesmo motivo do E2E ficar fora, ver .github/workflows/ci.yml):
//   node scripts/check-schema-drift.mjs
//
// Cron jobs fora da lista `kommoOwnedCrons` do manifest NÃO são tratados como
// erro — só listados como "não classificado" (ex.: os crons ghl-v2-* do achado
// 2026-08-05 no CLAUDE.md). Não é papel deste script decidir de quem é um cron;
// só avisar quando um cron NOSSO some ou quando aparece um novo não documentado.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "kommo-schema-manifest.json"), "utf8"),
);

// No Windows, `npx.cmd` é um script de shell — execFileSync só consegue rodar
// via cmd.exe /c (não dá pra chamar .cmd direto sem shell:true, que por sua vez
// quebra o quoting do SQL). Passar por `cmd /c` com args em array preserva o SQL
// como um argumento único nas duas plataformas.
const [bin, baseArgs] = process.platform === "win32"
  ? ["cmd.exe", ["/d", "/s", "/c", "npx"]]
  : ["npx", []];

function queryRows(sql) {
  let out;
  try {
    out = execFileSync(bin, [...baseArgs, "-y", "supabase", "db", "query", "--linked", sql], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (e) {
    console.error("Falha ao consultar o banco (supabase CLI linkado/autenticado?):", e.message);
    process.exit(2);
  }
  const parsed = JSON.parse(out);
  return parsed.rows ?? [];
}

function diff(label, declared, actual) {
  const declaredSet = new Set(declared);
  const actualSet = new Set(actual);
  const missing = declared.filter((x) => !actualSet.has(x)); // declarado, mas sumiu do banco
  const undocumented = actual.filter((x) => !declaredSet.has(x)); // no banco, mas não declarado
  return { label, missing, undocumented };
}

const tablesActual = queryRows(
  "select table_name from information_schema.tables where table_schema='kommo' order by 1;",
).map((r) => r.table_name);

const functionsActual = queryRows(
  "select p.proname as function_name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kommo' order by 1;",
).map((r) => r.function_name);

const cronsActual = queryRows("select jobname from cron.job order by 1;").map((r) => r.jobname);

const results = [
  diff("Tabelas (schema kommo)", manifest.tables, tablesActual),
  diff("Funções/RPCs (schema kommo)", manifest.functions, functionsActual),
  diff("Crons do Kommo", manifest.kommoOwnedCrons, cronsActual.filter((c) => manifest.kommoOwnedCrons.includes(c) || c.startsWith("kommo"))),
];
const unclassifiedCrons = cronsActual.filter(
  (c) => !manifest.kommoOwnedCrons.includes(c) && !c.startsWith("kommo"),
);

let hasDrift = false;
for (const { label, missing, undocumented } of results) {
  if (missing.length === 0 && undocumented.length === 0) {
    console.log(`✓ ${label}: sem divergência.`);
    continue;
  }
  hasDrift = true;
  console.log(`✗ ${label}:`);
  if (missing.length) console.log(`    declarado mas sumiu do banco: ${missing.join(", ")}`);
  if (undocumented.length) console.log(`    existe no banco mas não está no manifest: ${undocumented.join(", ")}`);
}

if (unclassifiedCrons.length) {
  console.log(
    `\nℹ Crons não classificados como Kommo nem Kommo-prefixados (provavelmente GHL/legado, ` +
    `ver CLAUDE.md > Achado 2026-08-05): ${unclassifiedCrons.join(", ")}`,
  );
}

if (hasDrift) {
  console.error("\nDivergência encontrada — atualize scripts/kommo-schema-manifest.json E a seção correspondente do CLAUDE.md.");
  process.exit(1);
}
console.log("\nSchema kommo bate com o manifest declarado.");
