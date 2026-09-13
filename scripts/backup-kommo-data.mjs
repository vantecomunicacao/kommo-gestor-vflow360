// Backup manual do schema `kommo` (Fase 0.3 do plano de remediação).
//
// O plano Supabase deste projeto é FREE — não tem backup automático nem PITR
// (isso é recurso pago, Pro pra cima). Este script é o substituto prático:
// exporta TODAS as linhas de todas as tabelas do schema `kommo` pra arquivos
// NDJSON locais, um por tabela, paginando (a API do Supabase corta em 1000
// linhas por chamada — mesmo padrão de `_shared/paginate.ts` nas edge
// functions). Não precisa de Docker/pg_dump/psql — só a service_role key que
// já está no `.env`.
//
// O ESQUEMA (tabelas/colunas/funções/triggers) já está 100% coberto pelas
// migrations versionadas em `supabase/migrations/` — isso não precisa de
// backup à parte. O que este script cobre é o que as migrations não cobrem:
// os DADOS (leads, contatos, configurações de cada workspace etc.).
//
// Uso:
//   node scripts/backup-kommo-data.mjs
//
// Saída: backups/<timestamp>/<tabela>.ndjson (uma linha = um registro JSON) +
// backups/<timestamp>/manifest.json (contagem por tabela, hora, tabelas que
// falharam). A pasta `backups/` é ignorada pelo git (dados reais de clientes
// não devem ir pro repositório) — guarde o resultado num lugar seguro seu
// (HD externo, storage próprio) depois de rodar.
//
// Recomendação de uso: rodar manualmente de vez em quando (ex.: 1x por mês,
// ou antes de qualquer operação arriscada tipo "Forçar recálculo" em massa).
// Não é um substituto de um backup automático de verdade — é a rede de
// segurança possível dentro do plano free.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function readEnvVar(name) {
  const env = readFileSync(path.join(repoRoot, ".env"), "utf8");
  const m = env.match(new RegExp(`^${name}="?([^"\r\n]+)"?`, "m"));
  if (!m) throw new Error(`Faltou ${name} no .env`);
  return m[1];
}

const SUPABASE_URL = readEnvVar("VITE_SUPABASE_URL");
const SERVICE_ROLE_KEY = readEnvVar("SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { db: { schema: "kommo" } });

const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "kommo-schema-manifest.json"), "utf8"),
);
const tables = manifest.tables;

// Coluna usada pra ordenar a paginação (precisa ser determinística e não-nula
// em toda linha). A maioria usa `id`; estas têm outra PK.
const ORDER_COL = {
  sync_status: "workspace_id",
  sync_watermarks: "workspace_id",
  dashboard_settings: "workspace_id",
  dashboard_cache: "workspace_id",
  user_permissions: "user_id",
};

const PAGE_SIZE = 1000;

async function dumpTable(table) {
  const orderCol = ORDER_COL[table] || "id";
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(repoRoot, "backups", stamp);
  mkdirSync(outDir, { recursive: true });

  const summary = { startedAt: new Date().toISOString(), tables: {}, errors: {} };
  console.log(`Backup em ${outDir}\n`);

  for (const table of tables) {
    process.stdout.write(`  ${table} ... `);
    try {
      const rows = await dumpTable(table);
      writeFileSync(
        path.join(outDir, `${table}.ndjson`),
        rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
        "utf8",
      );
      summary.tables[table] = rows.length;
      console.log(`${rows.length} linhas`);
    } catch (e) {
      summary.errors[table] = e.message ?? String(e);
      console.log(`FALHOU: ${summary.errors[table]}`);
    }
  }

  summary.finishedAt = new Date().toISOString();
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(summary, null, 2), "utf8");

  const totalRows = Object.values(summary.tables).reduce((a, b) => a + b, 0);
  const failed = Object.keys(summary.errors).length;
  console.log(`\nTotal: ${totalRows} linhas em ${Object.keys(summary.tables).length} tabelas.`);
  if (failed) {
    console.log(`⚠ ${failed} tabela(s) falharam — ver manifest.json.`);
    process.exitCode = 1;
  } else {
    console.log(`✓ Backup completo, sem falhas.`);
  }
  console.log(`\nGuarde a pasta "${outDir}" num lugar seguro fora do repositório`);
  console.log(`(ela é ignorada pelo git de propósito — não deve ir pro GitHub).`);
}

main().catch((e) => {
  console.error("Backup abortado:", e);
  process.exit(2);
});
