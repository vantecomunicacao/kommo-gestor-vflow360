# CLAUDE.md

Instruções persistentes para o Claude Code neste projeto (VFlow360 / Kommo).
Leia antes de qualquer alteração.

## Infraestrutura Supabase — DOIS projetos (desde 2026-08-02)

O Kommo foi migrado pra um **projeto Supabase próprio, isolado do GHL**. Não é
mais o banco compartilhado original. Isso muda o que significa "GHL" nas regras
abaixo — leia com atenção:

| | Projeto ATUAL do app | Projeto ANTIGO (compartilhado) |
| --- | --- | --- |
| Nome | Kommo VFlow360 Gestor | (sem nome fixo — o de sempre) |
| Ref | `fjncmmqvmocwykpshgsh` | `xcrfbpyhyznyufijrdry` |
| O que tem | só schema `kommo`, isolado, **zero GHL** | `kommo` (legado, pendente de descomissionar) + tudo do GHL (`public`/`ghl_*`) |
| `.env` do repo (`VITE_SUPABASE_URL` etc.) | ✅ aponta pra cá | — |
| Coolify (`kommo-gestor-vflow360-prod`) | ✅ builda apontando pra cá | — |
| Pode escrever? | Sim, é o produto vivo | **Só leitura**, exceto o que a Regra #1 abaixo permitir |

**Pendência conhecida:** o projeto antigo ainda guarda os dados originais do
Kommo (leads/contacts/workspaces pré-migração) e 3 crons `kommo-*` que foram só
**pausados** (não apagados) em 2026-08-02, aguardando o usuário migrar
manualmente o restante dos workspaces pro projeto novo. Só desligar
(`cron.unschedule`) ou remover algo do lado Kommo desse projeto antigo com
autorização explícita — mesmo sendo "nosso", é código morto pendente, não órfão.

**Achado 2026-08-05 — o projeto novo NÃO é 100% "zero GHL" como a tabela acima
descreve:** o schema `public` desse projeto (`fjncmmqvmocwykpshgsh`) tem 27
tabelas de um sistema "GHL v2" (`ghl_contacts`, `ghl_conversations`,
`suggestions`, `integrations`, `workspaces` etc.) e **6 crons ativos**
(`ghl-v2-sync-tick`, `ghl-v2-analyze-tick`, `ghl-v2-auto-execute-tick`,
`cleanup-system-logs-daily`, `purge-trashed-workspaces`, `ai-insights-tick`)
que leem esses dados e disparam chamadas (a cada 2-10min) pra edge functions
de produção no projeto **antigo** (`ghl-manage`, `ai-analyze-v2`,
`ai-insights-generate`, `ghl-conversations-sync`). Não é código morto — está
rodando de verdade. O usuário acredita que é de um "sistema antigo" e pode ser
apagado, mas a tentativa de pausar os crons (`cron.unschedule`) foi bloqueada
pelo classificador de permissão do Claude Code e **ficou pendente** — nada foi
alterado. Antes de mexer: confirmar que nada depende disso, e tratar como
ação irreversível (perda de dado) separada de só pausar (reversível).

**Fase 2 do plano de remediação (2026-08-05) — parcial:** `npm run lint` caiu de
339 → 152 problemas (136 erros). Corrigidos: `tailwind.config.ts`, `pdf-extract`,
e as 4 edge functions de maior risco (tocam API externa/dinheiro) —
`kommo-sync` (25→0), `kommo-ai-analyze` (15→0), `kommo-manage` (9→0),
`kommo-report-snapshot` (10→0). **Pendente:** ~136 erros ainda em
`kommo-dashboard/index.ts` (27), `cooling-leads/index.ts` (26),
`settings/DashboardSettings.tsx` (26), `Integrations.tsx` (8),
`_shared/dashboard-metrics.ts` (7), `settings/AiSettings.tsx` (7),
`kommo-actions/index.ts` (5), `_shared/kommo-client.ts` (5) + ~20 arquivos
menores (frontend hooks/páginas/componentes ui). Nenhum desses toca API
externa diretamente (menor risco de bug silencioso), mas o gate de lint da CI
(Fase 1) continua não-bloqueante até isso ser zerado.

**Fase 3 do plano de remediação (2026-08-06):** mapeamento de auth confirmou dois
modelos reais (não duplicação por preguiça): `kommo-sync`/`kommo-dashboard`/
`kommo-report-snapshot`/`kommo-ai-analyze` usam `authorizeWorkspace` (cobre o
caminho interno via `x-internal-secret`, usado pelos crons); `kommo-manage`,
`cooling-leads` e `kommo-actions` nunca precisaram desse caminho — migradas pros
novos helpers `resolveCallerIdentity`/`requireWorkspaceMember` (`_shared/authorize.ts`),
equivalentes ao que já faziam à mão. `kommo-admin-bootstrap`/`kommo-admin-users`
são operações GLOBAIS (não de workspace) — não fazem sentido em `authorizeWorkspace`;
usam só `resolveCallerIdentity`. CORS extraído pra `_shared/cors.ts` (duas variantes
reais, `corsHeadersBase`/`corsHeadersExtended` — `kommo-sync` ficou de fora por ter
uma terceira variante própria, único consumidor). `wipeWorkspaceData` documentado
como já seguro pra retry (delete idempotente + account_id só atualiza depois que
termina), sem precisar de transação. Guardrail de auth (Fase 1) atualizado pra
reconhecer os novos helpers como sinal válido.

**Fase 4 do plano de remediação (2026-08-06) — parcial:** `npx deno` (via
`npx -y deno ...`) ficou disponível nesta sessão, então `deno check`/`deno test`
passaram a rodar de verdade (antes eram só revisão manual). Isso achou e corrigiu
bugs reais de tipo em 7 arquivos (ver commit `381eba9`) — sinal de que vale
rodar `deno check` manualmente depois de qualquer mudança em `supabase/functions/`
até o CI (Fase 1) rodar sozinho. CI ganhou o step `deno test`
(`.github/workflows/ci.yml`). Testes novos: `_shared/authorize.test.ts` (caminho
interno inteiro + `requireWorkspaceMember`, com `db` mockado — o caminho JWT real
fica fora, exigiria rede ou refactor pra injeção) e
`kommo-dashboard/pure.test.ts`. As 4 funções puras que já eram standalone
(`inferFunnelMapping`, `extractCf`, `extractCfDate`, `extractCfValues`) foram
extraídas pra `kommo-dashboard/pure.ts` — **não** dava pra testar direto de
`index.ts` porque o `serve(...)` roda no nível do módulo (importar o arquivo pra
pegar as funções dispararia o handler HTTP inteiro). O teste já achou um
comportamento real do código (não é bug, é o comportamento atual): uma etapa
chamada "Proposta enviada" cai no bucket `fechamento`, não `proposta_enviada`,
porque o regex de fechamento inclui essa frase literal.

**Pendente da Fase 4:** o resto do `kommo-dashboard/index.ts` (~600 linhas) tem
várias funções computacionalmente puras mas escritas como closures dentro do
`serve()` (`computeTimePerStage`, `buildDist`, `cycleDays`, `countCurrentlyIn`,
etc.), capturando várias variáveis do escopo externo — extrair essas exige
threading explícito de parâmetros (risco real de erro de transcrição) e, por
isso, um golden test ANTES de extrair (conforme o plano original). Ainda não
decidido: snapshot de uma chamada HTTP real (precisa de workspace estável +
segredo interno) vs. fixtures sintéticas (sem dependência de dado ao vivo, mas
não pega discrepância contra edge cases reais de produção) — decisão em aberto
com o usuário.

**Achado 2026-08-05 — `pdf-extract` sem autorização:** essa edge function tem
`verify_jwt = false` e nenhuma checagem de auth (nem a real, nem um comentário
"Public endpoint" como o `log-event` tem). Endpoint aberto que processa PDF e
chama uma API de IA externa (custo por request). Guardrail de CI
(`scripts/check-auth-guardrail.mjs`) já detecta isso, mas está não-bloqueante
até alguém decidir se é bug (precisa de auth) ou intencional (documentar).

**`supabase db push` está QUEBRADO no projeto novo** (confirmado 2026-08-05): a
tabela de histórico de migrations do projeto novo não bate com o que já existe
no banco (herança da replicação em bloco de 2026-08-02), então `db push` tenta
reaplicar migrations antigas do zero — inclusive coisas do schema `public`/GHL
que nem deveriam estar aqui — e quebra em `relation already exists`. **Não usar
`db push` neste projeto.** Para aplicar uma migration nova, rodar o SQL direto
via `supabase db query --linked "<SQL>"` (mesmo padrão já usado em várias
migrations do changelog abaixo).

## Regras invioláveis

### 1. NÃO alterar nada do GHL (GoHighLevel) no Supabase

Aplica-se ao **projeto antigo** (`xcrfbpyhyznyufijrdry`) — é lá que o GHL roda de
verdade hoje, compartilhando infra com os resquícios do Kommo pré-migração. O
projeto novo (`fjncmmqvmocwykpshgsh`) não tem nada de GHL, então esta regra não
tem o que proteger lá — mas também não há razão pra criar algo `ghl_*` nele.

É **proibido** criar, modificar, renomear, mover ou excluir qualquer recurso do
Supabase relacionado ao GHL (no projeto antigo). Isso inclui — mas não se limita a:

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

Desde a separação de infra (2026-08-02), o schema `kommo` vive no **projeto
Supabase próprio** (`fjncmmqvmocwykpshgsh`), não mais compartilhado com o GHL.
É aqui que se cria, altera e exclui tabelas — o app aponta pra cá por padrão
(`src/integrations/supabase/client.ts` → `db: { schema: "kommo" }`). O nome do
schema (`kommo`, em vez de `public`) é herança do banco antigo compartilhado;
hoje é só convenção, sem função de isolamento real, mas não vale a pena renomear
só por estética (ver conversa arquivada sobre o assunto).

O **projeto antigo** (`xcrfbpyhyznyufijrdry`) continua existindo e é onde o GHL
roda de verdade — regras normais (Regra #1) se aplicam lá. Ele também tem um
schema `kommo` residual (dados pré-migração, pendente de descomissionar — ver
seção "Infraestrutura Supabase" acima). Ler esse projeto antigo é permitido
quando a tarefa exigir; escrever nele exige cuidado redobrado mesmo do lado
Kommo, porque ele é compartilhado com produção viva do GHL.

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
| `kommo.tasks` | Tarefas do CRM Kommo (prazo, responsável, concluída) — base de "tarefas atrasadas" por vendedor. Criada em `20260626130000_kommo_tasks.sql`, que também adiciona `kommo.leads.closest_task_at` |

Migrations posteriores que mexem no schema `kommo` **sem criar tabelas novas**:

- `20260805130000_kommo_cron_url_drift_fix.sql` — recria as 3 funções de cron
  (`trigger_sync_all`, `trigger_sync_all_full`, `trigger_report_snapshot_all`)
  só pra recapturar a URL/anon key do projeto novo (`fjncmmqvmocwykpshgsh`).
  As funções em produção já tinham sido corrigidas manualmente depois da
  separação de infra de 2026-08-02, mas as migrations anteriores
  (`20260709130000`, `20260721120000`) no repo ainda apontavam pro projeto
  antigo — divergência achada na auditoria de 2026-08-05. Sem mudança de
  comportamento, só sincroniza repo com o que já roda.
- `20260803150000_kommo_custom_metrics.sql` — adiciona coluna
  `kommo.dashboard_settings.custom_metrics jsonb` (até 3 métricas personalizadas
  por workspace, cada uma comparando contagens de leads por etapa/par
  pipeline+status; ex. "Taxa de No Show"). Aditiva; sem mudança de RLS.
- `20260717130000_kommo_sync_tick_every_12h.sql` — reagenda o cron
  `kommo-sync-tick` de 15min pra 12h (reduz carga na API do Kommo; o full-scan
  diário já cobre o resto). Não altera função nem tabela.
- `20260709130000_kommo_report_snapshot_cron.sql` — cria o cron
  `kommo-report-snapshot-daily` (03:10 UTC) que recomputa os últimos 12 meses +
  o mês corrente via `kommo-report-snapshot`. Não cria tabela.
- `20260805120000_kommo_custom_filters.sql` — adiciona coluna
  `kommo.dashboard_settings.custom_filters jsonb` (até 4 filtros extras por workspace,
  `{id, label, fieldId}`, editados na tela Configurações → aba "Filtros"). Cada filtro
  mapeia um campo personalizado de lead pra um dropdown extra na barra do Dashboard
  (`kommo-dashboard` lê a config, filtra `leads` e monta as opções distintas; payload
  novo `customFilters: {filterId: string[]}`). Aditiva; sem mudança de RLS.

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

- 2026-08-05 (`20260805130000_kommo_cron_url_drift_fix.sql`): sem mudança
  estrutural — corrige divergência repo-vs-banco nas 3 funções de cron (ver
  entrada na seção de migrations acima). Achada durante a auditoria/plano de
  remediação técnica de 2026-08-05. _(APLICADA em prod 2026-08-05 via
  `supabase db query --linked`.)_
- 2026-08-05 (`20260805120000_kommo_custom_filters.sql`): adiciona coluna
  `kommo.dashboard_settings.custom_filters jsonb` — até 4 filtros personalizados por
  workspace (`{id, label, fieldId}`), configurados em Configurações → aba "Filtros"
  (novo `CustomFiltersTab.tsx`, mesmo padrão de `custom_metrics`). Cada filtro mapeia
  um campo personalizado de LEAD pra um dropdown extra na barra de filtros do Dashboard
  (`Header.tsx`), com opções = valores distintos daquele campo. `kommo-dashboard` ganhou
  o payload `customFilters: Record<filterId, string[]>` e retorna `customFilterDefs`
  (id/label) + `customFilterValues` (opções). Aditiva; sem mudança de RLS. _(APLICADA em
  prod 2026-08-05 via `supabase db query --linked` — `db push` falhou tentando replayar
  todo o histórico de migrations antigo/GHL por causa da separação de infra de
  2026-08-02; edge `kommo-dashboard` redeployada.)_
- 2026-08-02: **separação de infraestrutura** — o schema `kommo` (todas as 21
  tabelas até aqui) foi replicado do projeto Supabase antigo compartilhado
  (`xcrfbpyhyznyufijrdry`) para o projeto novo e isolado
  (`fjncmmqvmocwykpshgsh`, "Kommo VFlow360 Gestor"), aplicando as 24 migrations
  `kommo_*` em sequência. App (Coolify) e edge functions redeployados apontando
  pro projeto novo. Ver seção "Infraestrutura Supabase" no topo deste arquivo.
  _(dados/usuários pré-migração ainda pendentes de portar manualmente do
  projeto antigo — cada workspace precisa reconectar a integração Kommo.)_
- 2026-08-03 (`20260803150000_kommo_custom_metrics.sql`): adiciona coluna
  `kommo.dashboard_settings.custom_metrics jsonb` — até 3 métricas
  personalizadas por workspace comparando contagens de leads por etapa
  (par pipeline+status), configuradas em Configurações (mesmo padrão depois
  reaproveitado por `custom_filters`). Achada faltando no changelog durante a
  auditoria de 2026-08-05, apesar de já aplicada em prod. Aditiva; sem mudança
  de RLS.
- 2026-08-03 (`20260803120000_kommo_sync_status_warning.sql`): adiciona coluna
  `kommo.sync_status.last_sync_warning text` — sync pode terminar `success` com
  ressalva registrada (ex.: teto de páginas de `contacts`/`leads` atingido,
  falha não-fatal em eventos/tarefas). Exibida na tela de Integrações. Aditiva;
  sem mudança de RLS. _(APLICADA no projeto novo 2026-08-03; edges `kommo-sync`
  e `kommo-manage` redeployadas.)_
- 2026-07-27 (`20260727190000_kommo_funnel_mapping_per_pipeline.sql`): migration de DADOS
  (sem mudança estrutural) — `kommo.dashboard_settings.funnel_stage_mapping` passa a ser
  indexado pelo PAR funil+etapa (`"<pipeline_kommo_id>:<status_id>"`) em vez de só pelo
  status. Motivo: `142`/`143` são os mesmos ids em TODOS os funis do Kommo e são
  renomeados por funil, então mapear uma etapa contaminava os outros funis. Cada chave
  legada foi expandida para os funis que contêm aquele status (comportamento preservado;
  0 chaves órfãs). O leitor novo (`_shared/kommo-funnel.ts`, usado por `kommo-dashboard` e
  `kommo-report-snapshot`) aceita os dois formatos, então a ordem deploy×migration não
  quebra. Nesta leva: some o `wonStageIds.add("142")` global (ganho agora = status `won`
  do Kommo OU etapa mapeada como venda_ganha NAQUELE funil) e o card "Funil padrão" virou
  "Funis do Dashboard" (checkbox multi-seleção; 1 marcado = pré-seleciona o filtro).
  _(APLICADA em prod 2026-07-27: edges deployadas antes, migration depois, e os 4
  workspaces com mapeamento conferidos antes/depois — funil, perdas e receita idênticos.)_
- 2026-07-27 (`20260727180000_kommo_pipelines_is_deleted.sql`): adiciona coluna
  `kommo.pipelines.is_deleted boolean default false` + índice parcial
  `idx_kommo_pipelines_ws_alive`. Funil apagado no Kommo ficava para sempre na tabela
  (o passo de pipelines do `kommo-sync` só fazia upsert, sem reconciliação de exclusão)
  e aparecia nos seletores. Agora o `kommo-sync` marca `is_deleted=true` nos funis que
  não vieram no snapshot (`/leads/pipelines` é catálogo completo; só reconcilia se a
  resposta não veio vazia) e `false` nos que voltaram. Soft delete porque os leads
  históricos referenciam `pipeline_id` por texto. Leitores passaram a filtrar
  `is_archive=false AND is_deleted=false`: `kommo-dashboard`, `kommo-ai-analyze`,
  `/relatorios`, Configurações › Dashboard (`cooling-leads` filtra só `is_deleted`,
  pois etapa de funil arquivado ainda é referenciada por lead antigo). Aditiva; sem
  mudança de RLS. _(APLICADA em prod 2026-07-27 via db query; 4 edges redeployadas e
  sync do workspace "Dr. Eduardo Townsend" rodado: 8 funis mortos marcados, 7 vivos.)_
- 2026-07-22 (`20260722130000_kommo_dashboard_analyses_pinned.sql`): adiciona coluna
  `kommo.dashboard_analyses.pinned boolean default false` — favoritar/fixar análises no topo
  do histórico. Toggle/exclusão pela edge `kommo-ai-analyze` (modos `pin`/`delete`, service role).
  Nesta leva de UX: skeleton, empty state, ícones/cores por seção, resumo na confirmação, gráfico
  de comparação, copiar/exportar PDF, regenerar, busca/título no histórico e STREAMING da resposta
  (edge modo analyze com `stream:true` → NDJSON; fallback JSON). Aditiva; sem mudança de RLS.
  _(APLICADA em prod 2026-07-22 via db query; edge redeployada.)_
- 2026-07-22 (`20260722120000_kommo_dashboard_analysis_messages.sql`): adiciona coluna
  `kommo.dashboard_analyses.messages jsonb default '[]'` — conversa de acompanhamento
  (follow-ups) da Análise IA: depois do relatório, o gestor pergunta mais, ancorado no
  MESMO snapshot (a edge `kommo-ai-analyze` modo `followup` NÃO re-consulta o CRM). Também
  nesta leva: a análise passou a receber o prompt LITERAL (não só o `foco` resumido) e o
  relatório mostra o comando que o gerou. Aditiva; sem mudança de RLS. _(aplicar em prod
  via SQL Editor + redeploy da edge.)_
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
- 2026-07-17 (`20260717130000_kommo_sync_tick_every_12h.sql`): sem mudança
  estrutural — reagenda o cron `kommo-sync-tick` de 15min pra 12h (menos carga
  na API do Kommo; full-scan diário cobre o resto). Achada faltando no
  changelog durante a auditoria de 2026-08-05.
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
- 2026-07-09 (`20260709130000_kommo_report_snapshot_cron.sql`): sem mudança
  estrutural — cria o cron `kommo-report-snapshot-daily` (03:10 UTC) que chama
  `kommo-report-snapshot` pra cada integração conectada. Achada faltando no
  changelog durante a auditoria de 2026-08-05.
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
- 2026-06-26 (`20260626130000_kommo_tasks.sql`): **nova tabela** `kommo.tasks` —
  tarefas do CRM Kommo (prazo, responsável, concluída), base de "tarefas
  atrasadas" por vendedor; também adiciona `kommo.leads.closest_task_at`.
  Achada faltando no inventário durante a auditoria/plano de remediação técnica
  de 2026-08-05, apesar de já estar aplicada em prod (confirmado por leitura
  direta do banco). Aditiva; sem mudança de RLS.
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
