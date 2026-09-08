// Fase 4.4 do plano de remediação (2026-09-08): as Métricas Personalizadas têm
// o MESMO shape validado em dois lugares, em runtimes diferentes:
//   - src/lib/custom-metrics.ts        (front, zod via npm/Vite)
//   - supabase/functions/_shared/schemas.ts  (edge, zod via URL/Deno)
// Os dois arquivos dizem, em comentário, "mantenha em sincronia" — este script
// falha a CI se as listas de ícone/cor, o modo de contagem, o formato e os
// limites (nº de métricas / refs por lado) divergirem.
//
// Parser por regex de propósito: não importa nenhum dos dois (runtimes/deps
// incompatíveis num mesmo processo Node). Se um refactor mudar demais o formato
// dos arquivos e o parser não achar um bloco, o script falha em vez de passar
// caladо — ajuste o regex aqui na mesma mudança.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontPath = path.join(repoRoot, "src", "lib", "custom-metrics.ts");
const edgePath = path.join(repoRoot, "supabase", "functions", "_shared", "schemas.ts");
const front = readFileSync(frontPath, "utf8");
const edge = readFileSync(edgePath, "utf8");

const problems = [];
const fail = (msg) => problems.push(msg);

/** Extrai `x` de `.max(x)` logo após `needle` (na mesma linha lógica). */
function maxAfter(src, needle, label) {
  const i = src.indexOf(needle);
  if (i === -1) { fail(`não achei \`${needle}\` em ${label}`); return null; }
  const m = src.slice(i, i + 200).match(/\.max\(\s*(\d+)\s*\)/);
  if (!m) { fail(`não achei \`.max(N)\` após \`${needle}\` em ${label}`); return null; }
  return Number(m[1]);
}

/** Extrai a lista de strings de `z.enum(["a","b"])` que segue `key:`. */
function enumAfter(src, key, label) {
  const re = new RegExp(`${key}\\s*:\\s*z\\.enum\\(\\s*\\[([^\\]]*)\\]`);
  const m = src.match(re);
  if (!m) { fail(`não achei \`${key}: z.enum([...])\` em ${label}`); return null; }
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

/** Chaves de um objeto literal `const NAME = { ... } as const`. */
function objectKeys(src, name, label) {
  const start = src.indexOf(`${name} = {`);
  if (start === -1) { fail(`não achei \`const ${name} = {\` em ${label}`); return null; }
  const end = src.indexOf("} as const", start);
  if (end === -1) { fail(`não achei o fim de \`${name}\` (\`} as const\`) em ${label}`); return null; }
  const body = src.slice(start, end);
  // chaves: começo de linha (após indentação), com ou sem aspas, seguidas de ":"
  return [...body.matchAll(/^\s*(?:["']([^"']+)["']|([A-Za-z0-9_-]+))\s*:/gm)]
    .map((m) => m[1] ?? m[2])
    .filter((k) => k !== "label" && k !== "Icon");
}

/** Strings de um array literal `const NAME = [ ... ] as const`. */
function arrayStrings(src, name, label) {
  const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`);
  const m = src.match(re);
  if (!m) { fail(`não achei \`const ${name} = [...] as const\` em ${label}`); return null; }
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

const sameSet = (a, b) => a && b && a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

// ---- 1. Ícones --------------------------------------------------------------
const frontIcons = objectKeys(front, "CUSTOM_METRIC_ICONS", "custom-metrics.ts");
const edgeIcons = arrayStrings(edge, "CUSTOM_METRIC_ICON_KEYS", "schemas.ts");
if (frontIcons && edgeIcons && !sameSet(frontIcons, edgeIcons)) {
  fail(`chaves de ÍCONE divergem:\n  front: ${JSON.stringify(frontIcons)}\n  edge : ${JSON.stringify(edgeIcons)}`);
}

// ---- 2. Cores -------------------------------------------------------------
const frontColors = objectKeys(front, "CUSTOM_METRIC_COLORS", "custom-metrics.ts");
const edgeColors = arrayStrings(edge, "CUSTOM_METRIC_COLOR_KEYS", "schemas.ts");
if (frontColors && edgeColors && !sameSet(frontColors, edgeColors)) {
  fail(`chaves de COR divergem:\n  front: ${JSON.stringify(frontColors)}\n  edge : ${JSON.stringify(edgeColors)}`);
}

// ---- 3. countMode / format ------------------------------------------------
for (const key of ["countMode", "format"]) {
  const f = enumAfter(front, key, "custom-metrics.ts");
  const e = enumAfter(edge, key, "schemas.ts");
  if (f && e && !sameSet(f, e)) {
    fail(`enum \`${key}\` diverge:\n  front: ${JSON.stringify(f)}\n  edge : ${JSON.stringify(e)}`);
  }
}

// ---- 4. Limites (nº de métricas / refs por lado) -------------------------
const frontMaxMetrics = (front.match(/MAX_CUSTOM_METRICS\s*=\s*(\d+)/) || [])[1];
const edgeMaxMetrics = maxAfter(edge, "CustomMetricsListSchema", "schemas.ts");
if (frontMaxMetrics != null && edgeMaxMetrics != null && Number(frontMaxMetrics) !== edgeMaxMetrics) {
  fail(`limite de métricas diverge: front MAX_CUSTOM_METRICS=${frontMaxMetrics} vs edge CustomMetricsListSchema.max(${edgeMaxMetrics})`);
}

const frontMaxRefs = (front.match(/MAX_STAGE_REFS_PER_SIDE\s*=\s*(\d+)/) || [])[1];
const edgeNumMax = maxAfter(edge, "numerator:", "schemas.ts");
const edgeDenMax = maxAfter(edge, "denominator:", "schemas.ts");
if (frontMaxRefs != null && edgeNumMax != null && Number(frontMaxRefs) !== edgeNumMax) {
  fail(`limite de refs diverge: front MAX_STAGE_REFS_PER_SIDE=${frontMaxRefs} vs edge numerator.max(${edgeNumMax})`);
}
if (edgeNumMax != null && edgeDenMax != null && edgeNumMax !== edgeDenMax) {
  fail(`na schemas.ts, numerator.max(${edgeNumMax}) != denominator.max(${edgeDenMax})`);
}

// ---- resultado ----------------------------------------------------------
if (problems.length) {
  console.error("✗ Métricas Personalizadas fora de sincronia entre front e edge:\n");
  for (const p of problems) console.error("  - " + p + "\n");
  console.error("Ajuste src/lib/custom-metrics.ts e supabase/functions/_shared/schemas.ts juntos.");
  process.exit(1);
}
console.log("✓ Métricas Personalizadas: front e edge em sincronia (ícones, cores, countMode, format, limites).");
