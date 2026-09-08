// Fase 4.3 do plano de remediação (2026-09-08): src/integrations/supabase/types.ts
// é GERADO (`supabase gen types`) a partir do schema `kommo` do projeto. Já
// aconteceu de ficar desatualizado por 5 tabelas sem ninguém notar (ver CLAUDE.md,
// leva de lint de 2026-08-06) — o que traz de volta `any` no front e esconde
// erros de tipo.
//
// Este script regenera os tipos e compara com o arquivo commitado. Falha se
// divergirem. Roda FORA da CI de propósito — precisa da CLI do Supabase
// linkada/autenticada (mesmo motivo do check-schema-drift.mjs e do E2E; ver
// .github/workflows/ci.yml). Rodar antes de releases maiores ou depois de
// aplicar migration:
//   node scripts/check-types-drift.mjs
//
// Não corrige sozinho. Se acusar drift, rode:
//   npx supabase gen types typescript --linked --schema kommo > src/integrations/supabase/types.ts
// revise o diff e commite junto com a migration que causou a mudança.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const typesPath = path.join(repoRoot, "src", "integrations", "supabase", "types.ts");

// Windows: `npx.cmd` só roda via cmd.exe /c (mesmo motivo comentado em
// check-schema-drift.mjs).
const [bin, baseArgs] = process.platform === "win32"
  ? ["cmd.exe", ["/d", "/s", "/c", "npx"]]
  : ["npx", []];

let generated;
try {
  generated = execFileSync(
    bin,
    [...baseArgs, "-y", "supabase", "gen", "types", "typescript", "--linked", "--schema", "kommo"],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 32 * 1024 * 1024 },
  );
} catch (e) {
  console.error("Falha ao gerar tipos (supabase CLI linkado/autenticado?):", e.message);
  process.exit(2);
}

const norm = (s) => s.replace(/\r\n/g, "\n").trimEnd() + "\n";
const current = norm(readFileSync(typesPath, "utf8"));
const fresh = norm(generated);

if (current === fresh) {
  console.log("✓ src/integrations/supabase/types.ts está em sincronia com o schema `kommo`.");
  process.exit(0);
}

// Diff resumido: primeira linha divergente + contagem.
const a = current.split("\n");
const b = fresh.split("\n");
let firstDiff = -1;
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) { firstDiff = i; break; }
}
console.error("✗ types.ts DIVERGE do schema `kommo` gerado agora.\n");
console.error(`  linhas: commitado ${a.length} vs gerado ${b.length}`);
if (firstDiff >= 0) {
  console.error(`  1ª divergência na linha ${firstDiff + 1}:`);
  console.error(`    - commitado: ${JSON.stringify(a[firstDiff] ?? "(fim do arquivo)")}`);
  console.error(`    + gerado   : ${JSON.stringify(b[firstDiff] ?? "(fim do arquivo)")}`);
}
console.error("\n  Regenerar e revisar:");
console.error("    npx supabase gen types typescript --linked --schema kommo > src/integrations/supabase/types.ts");
process.exit(1);
