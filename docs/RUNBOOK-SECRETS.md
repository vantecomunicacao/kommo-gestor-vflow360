# Runbook — Rotação de segredos (Fase 2 do plano de remediação)

> **Objetivo:** trocar as senhas/chaves que já passaram pela pasta sincronizada
> do OneDrive, **uma de cada vez**, sem o usuário do sistema perceber nada.
>
> Regras invioláveis do projeto (`../CLAUDE.md`): Supabase só o projeto
> `fjncmmqvmocwykpshgsh`; Coolify só o app `kommo-gestor-vflow360-prod`; push só
> pro GitHub oficial.

---

## Por que fazer isso (linguagem simples)

O arquivo `.env` do repositório guarda **todas as senhas do sistema**. Enquanto o
repositório esteve dentro do OneDrive, esse arquivo foi copiado automaticamente
pra nuvem da Microsoft. Não houve vazamento conhecido — mas a boa prática depois
de qualquer exposição possível é **trocar as chaves** e parar de sincronizar o
arquivo. É higiene, não incêndio.

---

## Etapa 2.0 — Tirar o `.env` do OneDrive (fazer PRIMEIRO, isolado) 🟢

Nada disso toca no sistema em produção — é só a sua máquina de desenvolvimento.

1. Feche o VS Code / qualquer coisa usando a pasta.
2. Mova a pasta inteira do projeto pra **fora** do OneDrive. Sugestão:
   `C:\dev\Kommo-Vflow360-Gestor` (qualquer lugar fora de
   `OneDrive\`, `Dropbox\`, `Google Drive\`).
3. Reabra o projeto do novo caminho. Rode `npm ci` e `npm run dev` uma vez pra
   confirmar que subiu normal.
4. Guarde **uma cópia dos segredos atuais** num gerenciador de senhas
   (Bitwarden, 1Password, o cofre do navegador). É a sua rede de segurança pro
   rollback de cada item abaixo.
5. (Opcional, recomendado) confirme que o `.gitignore` já ignora `.env` — ignora
   (`git check-ignore .env` responde `.env`).

> Enquanto o `.env` estiver no OneDrive, **não adianta rotacionar** — a chave
> nova cairia no mesmo lugar. 2.0 é pré-requisito de tudo abaixo.

---

## Regras da janela de rotação (2.1)

- Faça em **horário de baixo uso** (fim de tarde / noite).
- **Uma chave por vez.** Troca → atualiza todos os lugares que usam → testa →
  só então vai pra próxima.
- Tenha o **valor antigo em mãos** (do gerenciador de senhas) antes de trocar.
- Se algo falhar: repõe o valor antigo no mesmo lugar e o sistema volta.

---

## 2.1 — Segredos de baixo impacto (🟡 — efeito visível nenhum se seguir a ordem)

Ordem sugerida: do menos crítico pro mais crítico. `INTERNAL_FUNCTION_SECRET`
**por último**.

### a) `COOLIFY_API_TOKEN` — só automação local

- **Onde troca:** Coolify → ícone do perfil → **Keys & Tokens / API tokens** →
  revogar o atual, **Create New Token**.
- **Onde atualizar:** só no `.env` local (`COOLIFY_API_TOKEN=...`).
- **Testar:** nada em produção depende disso. Se você usa algum script local de
  deploy, rode um comando de leitura (listar apps) pra confirmar.
- **Rollback:** gerar outro token. (O antigo já foi revogado — não dá pra "voltar".)
- **Impacto no sistema:** **zero.**

### b) `SUPABASE_ACCESS_TOKEN` — só a CLI da Supabase na sua máquina

- **Onde troca:** https://supabase.com/dashboard/account/tokens → revogar o
  atual → **Generate new token**.
- **Onde atualizar:** só no `.env` local (`SUPABASE_ACCESS_TOKEN=...`).
- **Testar:** `supabase projects list` — tem que listar sem `401`.
- **Rollback:** gerar outro. (Sem volta pro antigo.)
- **Impacto no sistema:** **zero** (produção não usa esse token; é só pra
  `functions deploy` / `db push` a partir da sua máquina).

> **Este é o token que ficou pendente de revogar desde a Fase 1.** Fazer esta
> etapa **quita essa pendência**.

### c) `OPENAI_API_KEY` — só a Análise de IA (que está em beta / pausada)

- **Onde troca:** https://platform.openai.com/api-keys → criar chave nova →
  depois de tudo funcionando, **revogar a antiga**.
- **Onde atualizar:**
  - `.env` local (`OPENAI_API_KEY=...`), e
  - segredo das edge functions:
    `supabase secrets set OPENAI_API_KEY='<nova>' --project-ref fjncmmqvmocwykpshgsh`
  - **Obs.:** cada workspace pode ter a própria chave OpenAI salva no Vault
    (tela Configurações › IA). Essa é separada e **não** entra nesta rotação —
    quem configurou troca pela tela se quiser.
- **Testar:** abrir a Análise de IA num workspace que **não** tem chave própria
  e rodar uma análise curta. Se responder, a chave global está ok.
- **Rollback:** repor a chave antiga nos dois lugares (`.env` + `secrets set`).
  Só revogue a antiga na OpenAI **depois** do teste passar.
- **Impacto no sistema:** só a Análise de IA (beta). Dashboard/Relatório/Sync
  **não usam** essa chave.

### d) `SUPABASE_DB_PASSWORD` — conexão direta ao banco (CLI)

- **Onde troca:** Supabase → **Project Settings → Database → Database password →
  Reset database password**. Copie a nova na hora (só aparece uma vez).
- **Onde atualizar:** só no `.env` local (`SUPABASE_DB_PASSWORD=...`).
- **Testar:**
  `supabase db query --db-url "postgresql://postgres:<NOVA_SENHA_URLENCODED>@db.fjncmmqvmocwykpshgsh.supabase.co:5432/postgres" -c "select 1"`
  — tem que voltar `1`. (URL-encode: `@` → `%40`, `#` → `%23`, etc.)
- **Rollback:** **Reset** de novo e gerar outra. (A senha antiga não volta —
  por isso teste logo após trocar.)
- **Impacto no sistema:** **zero.** As edge functions e o app usam a
  `service_role` / `anon` key, **não** a senha do banco. Essa senha é só pra
  conexão direta via CLI (migrations pela alternativa `--db-url`, `psql`).

### e) `INTERNAL_FUNCTION_SECRET` — **por último**, dois lugares em lockstep

Este é o único com um pequeno "buraco" possível: os crons `postgres → edge`
mandam esse segredo no header pra provar que são internos. Se o valor do Vault
e o valor do env das functions ficarem **diferentes** por alguns minutos, um
ciclo de cron falha — **invisível pro usuário**, o próximo ciclo (ou o
full-scan diário) cobre.

- **Gerar valor novo:** qualquer string aleatória longa. Ex. no PowerShell:
  `[Convert]::ToBase64String((1..48 | % {Get-Random -Max 256}))`
- **Atualizar nos DOIS lugares, próximos no tempo:**
  1. **Vault** (via `db query --db-url`, uma linha):
     `select vault.update_secret((select id from vault.secrets where name = 'kommo_internal_function_secret'), '<NOVO_VALOR>');`
  2. **Env das 3 edge functions:**
     `supabase secrets set INTERNAL_FUNCTION_SECRET='<NOVO_VALOR>' --project-ref fjncmmqvmocwykpshgsh`
     (o secret é do projeto todo — vale pra `kommo-sync`, `kommo-dashboard` e
     `kommo-report-snapshot` de uma vez).
  3. `.env` local (`INTERNAL_FUNCTION_SECRET=...`).
- **Forçar o caminho interno agora, sem esperar o cron:** rode um **Sincronizar
  agora** pela tela de Integrações e confirme que respondeu sucesso/cooldown
  (esse caminho valida JWT+membership, não o secret) **e** aguarde/observe o
  próximo tick de `kommo-sync-tick` no log da function (esse sim usa o secret) —
  ou dispare o cron manualmente se souber. Se der `Forbidden` no caminho
  interno, os dois valores estão diferentes.
- **Rollback:** repor o valor **antigo** nos dois lugares (Vault + `secrets set`).
- **Impacto no sistema:** no pior caso, **1 ciclo de cron perdido** (o seguinte
  cobre). Nenhum efeito de tela.

---

## 2.4 — Setar a `ADMIN_BOOTSTRAP_ALLOWLIST` (aproveitar a mesma janela) 🟢

Defesa em profundidade: restringe quem pode virar o **primeiro** admin via
`kommo-admin-bootstrap`. Como **já existe admin** hoje, essa função retorna cedo
de qualquer forma — então setar isso **não muda nada visível agora**.

```bash
supabase secrets set ADMIN_BOOTSTRAP_ALLOWLIST='mktvantecomunicacao@gmail.com' --project-ref fjncmmqvmocwykpshgsh
```

> O usuário sugeriu incluir também `e2e-test@vflow360.internal`. Recomendo
> **deixar de fora**: essa conta de teste **já é admin** no banco
> (`kommo.user_roles`), então não perde acesso nenhum; e o sentido da allowlist é
> justamente impedir que uma identidade não-humana reivindique admin num cenário
> de recuperação. Se você preferir incluir mesmo assim, o valor vira
> `'mktvantecomunicacao@gmail.com,e2e-test@vflow360.internal'`.

- **Rollback:** `supabase secrets unset ADMIN_BOOTSTRAP_ALLOWLIST` (volta ao
  comportamento "qualquer autenticado", que na prática segue inócuo enquanto
  houver admin).

---

## Depois da rotação 2.1

- [ ] `.env` local atualizado com **todos** os valores novos, e **fora** do OneDrive.
- [ ] Cópia dos valores **novos** no gerenciador de senhas.
- [ ] Valores **antigos** apagados do gerenciador (depois de confirmar que tudo
      funciona) — não deixe chave morta guardada.
- [ ] Smoke test geral: login, Dashboard com números, Sincronizar agora,
      Relatório, Integrações. Nenhum erro novo em `public.system_logs`.

---

## 2.2 — Chaves mestras (`anon` / `service_role`) — ❌ DESCARTADA (decisão de 2026-09-08)

**Decisão do usuário: NÃO rotacionar.** Motivo: sistema interno de ~30 pessoas;
os segredos que dão acesso "de administrador" (`service_role` via
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `INTERNAL_FUNCTION_SECRET`,
tokens de CLI) são trocados na 2.1. A `anon` key sozinha só concede o que um
usuário **deslogado** já pode ver (RLS barra o resto). O custo — deslogar todos
os ~30 usuários de uma vez + atualização em lockstep de Coolify + env de 10 edge
functions + migration das chaves nos 3 crons — não se justifica pelo ganho.

Se algum dia houver suspeita concreta de vazamento da `service_role`/`anon`,
reabrir: janela de 15–30 min fora de horário, aviso prévio, checklist próprio.
