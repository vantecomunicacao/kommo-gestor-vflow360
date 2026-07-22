# CLAUDE.md

Instruções persistentes para o Claude Code neste projeto (VFlow360 / Kommo).
Leia antes de qualquer alteração.

## Regras invioláveis

### 1. NÃO alterar nada do GHL (GoHighLevel) no Supabase

É **proibido** criar, modificar, renomear, mover ou excluir qualquer recurso do
Supabase relacionado ao GHL. Isso inclui — mas não se limita a:

- **Edge functions:** `ghl-manage`, `ghl-sync`, `ghl-dashboard`,
  `ghl-conversations-sync`, `ghl-messages-sync`, `ghl-enrich-attachments`
- **Código compartilhado:** `supabase/functions/_shared/ghl-enrich.ts`,
  `supabase/functions/_shared/ghl-sync.ts`
- **Migrations / SQL:** qualquer tabela, coluna, view, função, trigger, cron ou
  policy ligada ao GHL (ex.: migrations com `ghl_` no nome)
- **Deploy / segredos / configuração** dessas funções no Supabase

Não fazer deploy, redeploy, nem rodar migrations que toquem nesses recursos.

Se uma tarefa parecer exigir mexer em algo do GHL: **pare e pergunte primeiro.**
Só prossiga com autorização explícita do usuário para aquela mudança específica.

### 2. Só enviar (push) para o GitHub oficial

O único repositório remoto autorizado é:

```text
https://github.com/vantecomunicacao/kommo-gestor-vflow360
```

- **Nunca** fazer `push` para outro remote/URL.
- **Nunca** adicionar, trocar ou criar outro remote de destino.
- Se o `origin` apontar para qualquer outro endereço: **pare e avise**, não envie.

### 3. Coolify — SÓ o projeto `Kommo-Gestor-Vflow360`

O Coolify (`http://72.60.248.166:8000`) é **compartilhado** com a produção do GHL.

- A **única** coisa que pode ser criada, alterada, deployada, reiniciada ou parada é
  o projeto **`Kommo-Gestor-Vflow360`** (e os recursos dentro dele).
- **Em hipótese alguma** alterar, deployar, reiniciar, parar ou excluir qualquer
  outro projeto/app/serviço/banco no Coolify — mesmo que o token enxergue.
  Isso inclui (mas não se limita a) o projeto/app do **GHL** (ex.: `VFlow360-Gestor-prod`).
- Operações de **leitura** (listar/inspecionar) são permitidas para identificar recursos.
- Antes de **qualquer** ação de escrita (deploy/restart/stop/update/delete), **mostrar
  o nome + UUID do recurso** que será tocado e **pedir confirmação**. Se o alvo resolver
  para um UUID/slug que **não** seja do `Kommo-Gestor-Vflow360`: **parar e avisar**, nunca
  "tentar o que parece certo".

## Onde ficam as tabelas (schemas do Supabase)

O Supabase é compartilhado, mas dividido em "andares" (schemas):

- **`kommo`** → schema **DESTE sistema** (VFlow360 Kommo). É aqui que se cria,
  altera e exclui tabelas. O app aponta para cá por padrão
  (`src/integrations/supabase/client.ts` → `db: { schema: "kommo" }`).
- **`public`** → schema do sistema **antigo / GHL**. Pode ser **lido/consultado**
  quando a tarefa exigir, mas **alterações ficam restritas**: nunca tocar em
  tabelas `ghl_*` nem em outras tabelas do `public` sem autorização explícita
  (ver Regra #1). Mudança de estrutura no `public` → **pare e pergunte**.

### Tabelas do Kommo (schema `kommo`) — inventário oficial

> **MANTER ATUALIZADO:** toda vez que uma tabela do schema `kommo` for criada,
> excluída, renomeada (ou houver mudança estrutural relevante), **atualize esta
> lista na MESMA alteração**, anotando a data e a migration responsável. Esta
> lista é a fonte de verdade — não deixe ela divergir do banco.

Criadas na migration fundacional `20260617120000_kommo_schema_foundation.sql`:

| Tabela | Função (resumo) |
| --- | --- |
| `kommo.profiles` | Perfis de usuário |
| `kommo.users` | Usuários do CRM Kommo |
| `kommo.user_roles` | Papéis/roles de usuário |
| `kommo.user_permissions` | Permissões por usuário |
| `kommo.workspaces` | Workspaces (contas) |
| `kommo.workspace_members` | Membros de cada workspace |
| `kommo.integrations` | Conexões de integração (CRM) |
| `kommo.pipelines` | Funis e etapas |
| `kommo.custom_fields` | Campos personalizados |
| `kommo.loss_reasons` | Motivos de perda |
| `kommo.contacts` | Contatos |
| `kommo.leads` | Leads / negócios |
| `kommo.sync_status` | Status de sincronização |
| `kommo.sync_watermarks` | Marcos de sincronização (incremental) |
| `kommo.dashboard_settings` | Configurações do dashboard |
| `kommo.lead_stage_events` | Histórico de mudança de etapa dos leads (tempo por etapa) |
| `kommo.report_snapshots` | Fotos mensais congeladas (relatório de comparação mês a mês) |
| `kommo.lead_actions` | Ações do vflow por lead (tarefa/tag criadas) — anti-duplicidade dos leads esfriando |
| `kommo.dashboard_analyses` | Histórico das análises de IA sob demanda do Dashboard (prompt + params + resultado + custo) |
| `kommo.ai_provider_config` | Chave OpenAI/modelo por usuário (tela Configurações › IA) — antes gravava no public/GHL e falhava |

Migrations posteriores que mexem no schema `kommo` **sem criar tabelas novas**:

- `20260709160000_kommo_report_goals.sql` — adiciona coluna
  `kommo.dashboard_settings.report_goals jsonb` (metas fixas mensais por métrica do
  Relatório; chave `"<eixo>:<metricId>"`, ex.: `{"fechamento:won":30}`). Editada/gravada
  pelo frontend (tela /relatorios) via upsert; atingimento mostrado na coluna "atual" e
  linha de meta no gráfico.

- `20260618120000_kommo_vault_token.sql` — token da integração no Vault
- `20260618130000_kommo_sync_cron.sql` — cron de sincronização (tick incremental 15min)
- `20260710140000_kommo_sync_full_daily.sql` — full-scan diário (`{full:true}`, 06:20 UTC)
  que dispara a reconciliação de exclusões no `kommo-sync` (marca `is_deleted` nos leads
  que sumiram do Kommo; o tick incremental sozinho nunca via exclusões)
- `20260625120000_kommo_workspace_functions.sql` — RPCs de workspace/membros no
  schema `kommo` (`create_workspace`, `can_manage_workspace`,
  `list_workspace_members`, `add_workspace_member`, `remove_workspace_member`)
- `20260627120000_kommo_funnel_stage_labels.sql` — adiciona coluna
  `kommo.dashboard_settings.funnel_stage_labels jsonb` (rótulos customizados das 4
  fases do funil; override aplicado no frontend, sem redeploy da edge function)
- `20260707120000_kommo_sync_watermarks_incremental.sql` — adiciona colunas
  `kommo.sync_watermarks.contacts_last_seen_at / tasks_last_seen_at / events_last_seen_at`
  (marco por entidade p/ o sync incremental do `kommo-sync`; NULL = full-scan)

#### Histórico de mudanças nas tabelas (changelog)

> Registre aqui cada criação/exclusão/alteração estrutural de tabela `kommo`,
> com data (AAAA-MM-DD) e migration. Mais recente no topo.

- 2026-07-21 (`20260721150000_kommo_ai_provider_config.sql`): **nova tabela**
  `kommo.ai_provider_config` — chave OpenAI/modelo por usuário (tela Configurações › IA).
  Corrige o "não salva": o client aponta para o schema `kommo`, mas a tabela só existia
  em `public` (GHL), então o insert/update falhava silencioso. Espelha a estrutura da
  versão public, isolada. Lida também pela edge `kommo-ai-analyze`. _(APLICADA em prod
  2026-07-22 via SQL Editor.)_
- 2026-07-21 (`20260721140000_kommo_dashboard_analyses.sql`): **nova tabela**
  `kommo.dashboard_analyses` — histórico das análises de IA sob demanda do Dashboard
  (workspace × usuário × momento; `params`/`metrics` jsonb, `result` texto, `cost_usd`).
  Escrita pela edge function `kommo-ai-analyze` (modo `analyze`) via service role; leitura
  por membros via RLS. O custo do modelo é gravado aqui (não em `public.ai_usage_log`, que
  é do GHL). _(APLICADA em prod 2026-07-22 via SQL Editor; edge kommo-ai-analyze deployada.)_
- 2026-07-21 (`20260721120000_kommo_cron_internal_secret.sql`): hardening de auth das
  edge functions — recria os 3 crons (`trigger_sync_all`, `trigger_sync_all_full`,
  `trigger_report_snapshot_all`) para enviarem o header `x-internal-secret` (valor do
  Vault `kommo_internal_function_secret`) + nova função `kommo.internal_function_secret()`.
  As edges `kommo-dashboard/sync/report-snapshot` passaram a EXIGIR JWT+membership OU esse
  segredo (fim do "sem usuário = liberado"), via `_shared/authorize.ts`. Sem mudança
  estrutural de tabela. _(APLICADA em prod 2026-07-21: Vault secret criado, env
  `INTERNAL_FUNCTION_SECRET` gravado, migration rodada via `supabase db query --linked`,
  3 edges redeployadas e smoke-testadas — sem segredo = Forbidden, com segredo = OK.)_
- 2026-07-17 (`20260717120000_kommo_report_snapshots_rls_fix.sql`): fix de consistência
  de RLS em `kommo.report_snapshots` — adiciona a policy `"svc all"` (FOR ALL TO
  service_role) que faltava e revoga o excesso `insert/update/delete` de `authenticated`
  (grant "morto"), alinhando ao padrão das demais tabelas. Sem mudança estrutural; hardening
  de login/senha. _(aplicar em prod via SQL direto — pendente.)_
- 2026-07-09 (`20260709160000_kommo_report_goals.sql`): adicionada coluna
  `kommo.dashboard_settings.report_goals jsonb` — metas fixas mensais por métrica do
  Relatório (edição na tela /relatorios, atingimento na coluna "atual" + linha de meta
  no gráfico). _(aplicada em prod via SQL direto — pg, 2026-07-09.)_
- 2026-07-09 (`20260709150000_kommo_report_rate_stages.sql`): adicionada coluna
  `kommo.dashboard_settings.report_rate_stages text[]` — etapas escolhidas p/ virarem
  "taxas de etapa" no Relatório (ex.: Taxa de Agendamento); a edge function
  `kommo-report-snapshot` calcula alcance por safra. _(aplicada em prod via SQL direto.)_

- 2026-07-09 (`20260709140000_kommo_lead_actions.sql`): **nova tabela**
  `kommo.lead_actions` — registra tarefa/tag que o vflow criou em cada lead (workspace ×
  lead × kind, `unique`). Escrita pela edge function `kommo-actions` (idempotência +
  anti-duplicidade dos leads esfriando); leitura por membros via RLS. _(aplicada em prod
  via SQL direto.)_
- 2026-07-09 (`20260709120000_kommo_report_snapshots.sql`): **nova tabela**
  `kommo.report_snapshots` — fotos mensais congeladas (workspace × funil × mês × eixo,
  `metrics` jsonb) para a tela de Relatórios (comparação mês a mês). Escrita pela edge
  function `kommo-report-snapshot`; leitura por membros via RLS. _(ainda não aplicada em
  prod — em validação local)._
- 2026-07-07 (`20260707120000_kommo_sync_watermarks_incremental.sql`): adicionadas
  colunas `contacts_last_seen_at`, `tasks_last_seen_at`, `events_last_seen_at` em
  `kommo.sync_watermarks` — habilitam o sync incremental por entidade no `kommo-sync`
  (puxa só o que mudou via `filter[updated_at|created_at][from]`; NULL = full-scan).
  _(ainda não aplicada em prod — em validação local)._
- 2026-06-27 (`20260627120000_kommo_funnel_stage_labels.sql`): adicionada coluna
  `kommo.dashboard_settings.funnel_stage_labels jsonb` — rótulos customizados das 4
  fases do funil (Configurações → "Nomes das etapas do funil"). _(ainda não
  aplicada em prod — em validação local)._
- 2026-06-26 (`20260626120000_kommo_lead_stage_events.sql`): **nova tabela**
  `kommo.lead_stage_events` — histórico de mudança de etapa (Kommo /events) para
  calcular "Tempo por etapa" e velocidade do funil. _(ainda não deployada/aplicada
  em prod — em validação local)._
- 2026-06-25 (`20260625130000_kommo_dashboard_chart_fields.sql`): adicionada coluna
  `kommo.dashboard_settings.chart_custom_fields text[]` (restaura a feature nativa de
  escolher quais campos personalizados viram gráfico de pizza no dashboard).
- 2026-06-25 (`20260625120000_kommo_workspace_functions.sql`): adicionadas RPCs de
  gestão de workspace/membros no schema `kommo` (não cria/altera tabelas; apenas
  funções `SECURITY DEFINER` espelhando as de `public`, mas gravando em `kommo.*`).
