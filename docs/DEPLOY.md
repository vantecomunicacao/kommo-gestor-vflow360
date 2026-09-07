# Runbook de Deploy — VFlow360 / Kommo Gestor

> Sequência segura para colocar mudanças em produção, com o **rollback de cada
> tipo**. Vale para qualquer mudança: migration, edge function, frontend.
>
> Regras invioláveis do projeto (ver `../CLAUDE.md`):
> - Push **só** para `https://github.com/vantecomunicacao/kommo-gestor-vflow360`.
> - Supabase: **só** o projeto `fjncmmqvmocwykpshgsh` (schema `kommo`). Nada de GHL.
> - Coolify: **só** o app `kommo-gestor-vflow360-prod`
>   (uuid `w3z7rpi5ih3ixfzowapg6uy0`). Nenhum outro recurso.

---

## 0. Antes de qualquer deploy (pré-flight)

> **Credenciais.** A CLI da Supabase precisa de um **access token válido** para
> `functions deploy` e para `db push --linked` (Management API). Se
> `supabase projects list` devolver `401 Unauthorized`, o token do `.env`
> (`SUPABASE_ACCESS_TOKEN`) expirou — gere outro em Dashboard → Account → Access
> Tokens (ou `supabase login`). Migrations têm alternativa sem Management API:
> `supabase db query --db-url "postgresql://postgres:<SENHA_URLENCODED>@db.<ref>.supabase.co:5432/postgres" -f <arquivo.sql>`
> usando `SUPABASE_DB_PASSWORD`.

Rode na sua máquina, com o repo **fora** de pasta sincronizada (OneDrive etc.):

```bash
npm ci
npm run lint          # tem que dar 0 problemas
npm test              # unit (vitest)
npm run typecheck     # tsc -p tsconfig.app.json (após o fix do item 1.1) — 0 erros
```

Se tocou em `supabase/functions/**`:

```bash
for d in supabase/functions/*/; do
  [ "$(basename "$d")" = "_shared" ] && continue
  npx -y deno check "$d/index.ts"
done
node scripts/check-auth-guardrail.mjs
npx -y deno test --allow-env supabase/functions/_shared/ supabase/functions/kommo-dashboard/
```

Se tocou no schema (`supabase/migrations/**`):

```bash
node scripts/check-schema-drift.mjs   # precisa da CLI logada/linkada; roda local
```

**Janela:** faça o deploy em **horário de baixo uso**. Tenha o commit/valor de
rollback **identificado antes de começar** (ver seção 5).

**Ordem obrigatória quando há mais de um tipo de mudança:**

```
1) migration  →  2) edge function  →  3) frontend
```

Motivo: a função nova pode depender da coluna nova; o frontend novo pode depender
da função nova. Nunca o contrário.

---

## 1. Migration (schema `kommo`)

`supabase db push` voltou a funcionar para migrations novas desde 2026-08-10
(ver `../CLAUDE.md`). Aplicar na mão via `supabase db query --linked` continua
válido como alternativa.

```bash
# 1. revisar o que será aplicado — NÃO pule este passo
supabase db push --linked --dry-run

# 2. aplicar
supabase db push --linked

# 3. validar
supabase migration list --linked          # local x remote batendo
node scripts/check-schema-drift.mjs        # schema x manifesto batendo
```

Depois de aplicar: **atualize o inventário** em `../CLAUDE.md`
("Tabelas do Kommo") e `scripts/kommo-schema-manifest.json` **na mesma mudança**.

### Rollback de migration

- **Nunca** editar uma migration já aplicada. **Nunca** rodar `db reset` em produção.
- Escreva uma **migration compensatória** nova (ex.: `DROP COLUMN` que a anterior
  adicionou, `cron.unschedule` do job que a anterior criou) e aplique por
  `supabase db push --linked`.
- Migrations deste plano são **aditivas** (coluna/tabela/cron novos, sem tocar em
  dado existente) — a compensatória é simétrica e sem perda de dado real.

---

## 2. Edge function (Deno)

Uma função por vez. Deploy só das que mudaram.

```bash
# pré: já rodou deno check + deno test + check-auth-guardrail (seção 0)

supabase functions deploy <nome>          # ex.: kommo-sync, log-event
```

**Smoke test imediato** (com um token real de um usuário membro de um workspace):

```bash
curl -sS -X POST "https://fjncmmqvmocwykpshgsh.supabase.co/functions/v1/<nome>" \
  -H "Authorization: Bearer <JWT_DE_UM_USUARIO>" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"workspace_id":"<WS_ID>"}' | head -c 800
```

- `kommo-dashboard` → deve voltar o JSON de métricas (tem `totalLeads`).
- `kommo-sync` → `{"success":true,...}` ou `{"error":"COOLDOWN:..."}` (também OK).
- `log-event` → `{"ok":true}`.
- Sem `Authorization` → deve voltar **403** (`Forbidden`), nunca 200.

### Secrets de edge function

```bash
supabase secrets list
supabase secrets set NOME=valor        # aplica no próximo cold start
```

### Rollback de edge function

```bash
git revert <commit>          # ou git checkout <commit_anterior> -- supabase/functions/<nome>
supabase functions deploy <nome>
```

O deploy anterior é substituído; não há "versão N-1" automática — o rollback é
re-deployar o código antigo. Por isso: **um commit atômico por função**.

---

## 3. Frontend (Coolify)

Build args atuais (Dockerfile): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
Se um item adicionar um novo `VITE_*` (ex.: `VITE_ERROR_WEBHOOK_URL` no item 1.3),
**adicione ao Dockerfile como `ARG`/`ENV` e cadastre nos _build args_ do Coolify
antes do deploy**, senão ele sai `undefined` no bundle.

```bash
npm run build                 # confirma que buildou local antes de subir
```

- Coolify → app `kommo-gestor-vflow360-prod` → **Redeploy** (ou push na branch que
  o Coolify observa, se for auto-deploy).
- Confirme que o Coolify pegou o **commit certo** antes de confirmar.

### Rollback de frontend

- Coolify → app → histórico de deploys → **Redeploy** do build anterior
  (verde/estável). É o rollback mais rápido e sem tocar em git.
- Alternativa: `git revert` + novo deploy.

---

## 4. Checklist pós-deploy (todo deploy)

Abrir o app logado e verificar, sem erro no console:

- [ ] **Login** entra e cai no Dashboard.
- [ ] **Dashboard** carrega com números (não zerado/erro).
- [ ] **Sincronizar agora** responde (sucesso ou cooldown).
- [ ] **Relatórios** abre e mostra os meses.
- [ ] **Análise de IA** abre (com o selo "beta" após o item 1.4).
- [ ] **Integrações** mostra o status da conexão.
- [ ] **Admin** lista usuários.
- [ ] **Leads Esfriando** abre.
- [ ] Nenhum erro novo em `public.system_logs` nem no webhook de erro.
- [ ] (se mexeu no schema) `node scripts/check-schema-drift.mjs` verde.

---

## 5. Antes de começar: tenha o rollback pronto

| Tipo | O que anotar antes | Como reverter |
|---|---|---|
| Migration | número da migration nova | escrever migration compensatória + `db push` |
| Edge function | hash do commit anterior por função | `git revert` + `functions deploy <nome>` |
| Frontend | build verde anterior no Coolify | Redeploy desse build no Coolify |
| Secret | valor **antigo** guardado no gerenciador de senhas | `supabase secrets set NOME=<valor antigo>` |
| Header nginx (CSP) | conteúdo antigo do bloco `add_header` | `git revert` + redeploy frontend |

---

## 6. CI (roda sozinho no PR / push)

`.github/workflows/ci.yml` — **bloqueante**:

- Frontend: `typecheck`, `test`, `lint`.
- Edge: `deno check` (todas as functions), `check-auth-guardrail.mjs`, `deno test`.

Fora da CI (rodar manual antes de release maior):

- `node scripts/check-schema-drift.mjs` (precisa de credencial do projeto).
- `npm run test:e2e` (Playwright, backend mockado).
