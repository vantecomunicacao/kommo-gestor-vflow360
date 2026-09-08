// Fase 4.2 do plano de remediação (2026-09-08): a inferência da fase do funil
// PELO NOME da etapa vive em dois lugares (runtimes diferentes):
//   - supabase/functions/kommo-dashboard/pure.ts  → inferFunnelMapping()  (fonte da verdade)
//   - src/lib/dashboard-funnel.ts                 → inferStageBucket()    (só p/ o selo
//                                                    "Inferido" na tela de Configurações)
// Este script (roda na CI, estático) falha se a escada de regex divergir entre
// os dois. Se mudar a classificação, mude nos DOIS e ajuste este check se
// precisar.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const edgePath = path.join(repoRoot, "supabase", "functions", "kommo-dashboard", "pure.ts");
const frontPath = path.join(repoRoot, "src", "lib", "dashboard-funnel.ts");

/** Extrai o corpo de uma função pelo nome (do `function <name>` até o fecho `\n}`). */
function fnBody(src, name, label) {
  const i = src.indexOf(`function ${name}`);
  if (i === -1) { console.error(`✗ não achei \`function ${name}\` em ${label}`); process.exit(2); }
  const end = src.indexOf("\n}", i);
  return src.slice(i, end === -1 ? undefined : end);
}

/** Sequência ordenada de "gatilho => resultado" da escada de classificação. */
function ladder(body) {
  const steps = [];
  // checagens por id: `id === "142"` / `id === "143"`
  for (const m of body.matchAll(/id === "(\d+)"/g)) steps.push(`id:${m[1]}`);
  // regex de nome, na ordem em que aparecem
  for (const m of body.matchAll(/\/\(([^/]+)\)\/\.test\(n\)/g)) steps.push(`re:${m[1]}`);
  return steps;
}

const edge = ladder(fnBody(readFileSync(edgePath, "utf8"), "inferFunnelMapping", "pure.ts"));
const front = ladder(fnBody(readFileSync(frontPath, "utf8"), "inferStageBucket", "dashboard-funnel.ts"));

if (JSON.stringify(edge) !== JSON.stringify(front)) {
  console.error("✗ inferência de fase do funil fora de sincronia entre edge e front:\n");
  console.error("  pure.ts            : " + JSON.stringify(edge));
  console.error("  dashboard-funnel.ts: " + JSON.stringify(front));
  console.error("\nAjuste inferFunnelMapping (pure.ts) e inferStageBucket (dashboard-funnel.ts) juntos.");
  process.exit(1);
}
console.log("✓ Inferência de fase do funil: edge e front em sincronia (" + edge.length + " regras).");
