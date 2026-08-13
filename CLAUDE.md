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

**Migração de workspaces legados: DESCONTINUADA (decisão de 2026-08-10).** O
projeto antigo guarda os dados originais do Kommo (leads/contacts/workspaces
pré-migração), mas o usuário decidiu que ele **não tem mais relação com o
projeto novo** — não vai migrar o restante dos workspaces manualmente. Isso foi
confirmado tecnicamente na mesma data: nenhuma function do projeto novo
(`fjncmmqvmocwykpshgsh`) referencia a URL do projeto antigo. Os 3 crons
`kommo-*` que ficaram **pausados** (não apagados) em 2026-08-02
(`kommo-report-snapshot-daily`, `kommo-sync-full-daily`, `kommo-sync-tick`)
estão pendentes de remoção definitiva (`cron.unschedule` + eventual `DROP`),
aguardando o usuário rodar uma consulta de leitura no SQL Editor do projeto
antigo (as credenciais desse projeto foram removidas do `.env` de propósito —
Regra #1) pra confirmar o conteúdo exato antes de gerar o SQL de remoção.
Enquanto pausados, risco real é zero (não afetam nada, o projeto novo é
independente); não desligar/remover algo do lado Kommo desse projeto antigo
sem autorização explícita — mesmo sendo "nosso", é código morto pendente, não
órfão.

**Achado 2026-08-05, RESOLVIDO 2026-08-08 — o schema `public` (GHL v2) foi
removido deste projeto.** O achado original: o schema `public` desse projeto
(`fjncmmqvmocwykpshgsh`) tinha 27 tabelas de um sistema "GHL v2" (`ghl_contacts`,
`ghl_conversations`, `suggestions`, `integrations`, `workspaces` etc.), 17
funções e 6 crons (`ghl-v2-sync-tick`, `ghl-v2-analyze-tick`,
`ghl-v2-auto-execute-tick`, `cleanup-system-logs-daily`,
`purge-trashed-workspaces`, `ai-insights-tick`) que disparavam chamadas pra
edge functions de produção no projeto **antigo** (`ghl-manage`, `ai-analyze-v2`,
`ai-insights-generate`, `ghl-conversations-sync`).

Antes de remover, uma auditoria confirmou (2026-08-08): (1) as 27 tabelas
estavam **100% vazias** (0 linhas) — as 4 funções de trigger dos crons fazem
`FOR ... IN SELECT ... FROM public.<tabela>` e nunca tinham nada pra iterar,
ou seja, os crons já disparavam sem fazer nada há tempos, não era automação
viva; (2) a única linha real encontrada em qualquer tabela `public.*` era em
`system_logs` — 8 registros de erro do **próprio Kommo** (via `log-event`,
gravando sem especificar schema → cai em `public` por padrão), não do GHL.

**O que foi removido:** 5 crons (`ghl-v2-sync-tick`, `ghl-v2-analyze-tick`,
`ghl-v2-auto-execute-tick`, `ai-insights-tick`, `purge-trashed-workspaces`),
12 funções (`add_workspace_member`, `can_manage_workspace`, `create_workspace`,
`get_my_permissions`, `is_workspace_member`, `list_workspace_members`,
`remove_workspace_member`, `trigger_ghl_sync_all`, `trigger_ghl_v2_analyze_due`,
`trigger_ghl_v2_auto_execute`, `trigger_ghl_v2_sync_all`,
`trigger_ai_insights_all`) e 25 tabelas (todo `public.*` exceto as duas abaixo).

**O que ficou (uso real confirmado, não é GHL):** `public.profiles` (tem um
gatilho `on_auth_user_created` → `handle_new_user()` em `auth.users` —
`auth.users` é compartilhado entre os dois sistemas neste projeto, então
apagar quebraria a criação de QUALQUER usuário novo, inclusive do Kommo) e
`public.system_logs` (recebe os logs de erro do frontend do Kommo via
`log-event`, ver achado acima). Funções mantidas por dependência real:
`handle_new_user`, `has_role` (usado em RLS de `profiles`/`system_logs`),
`update_updated_at_column` (trigger em `profiles`), `cleanup_old_system_logs`
(cron `cleanup-system-logs-daily`, que também ficou — é do Kommo, só mora em
`public` por herança histórica). Ver `scripts/kommo-schema-manifest.json` →
`publicSchemaKept` pra essa lista ficar rastreada.

Execução: os crons foram desligados via `supabase db query --linked`
(`cron.unschedule`, funcionou desta vez); `DROP FUNCTION`/`DROP TABLE` foram
bloqueados pelo classificador de permissão do Claude Code (mesmo padrão de
bloqueio de tentativas anteriores) — o **usuário rodou manualmente** no SQL
Editor do Supabase Dashboard, com o SQL revisado antes. Verificado depois via
consulta direta (só sobrou o esperado) e `node scripts/check-schema-drift.mjs`
(schema `kommo` intacto). Resíduo residual conhecido, não removido por ser
inofensivo (função órfã sem tabela-alvo, não afeta nada): `mark_conv_has_messages`.

**Fase 2 do plano de remediação — CONCLUÍDA (2026-08-06):** `npm run lint` foi
de 339 problemas (na análise original) a **0** (erros e warnings), no critério
redefinido pela 3ª revisão do plano ("zero nos arquivos Kommo-owned", não no
repo inteiro — 37% da dívida original era GHL, fora do escopo por Regra #1).
2026-08-05: as 4 edge functions de maior risco (tocam API externa/dinheiro) —
`kommo-sync` (25→0), `kommo-ai-analyze` (15→0), `kommo-manage` (9→0),
`kommo-report-snapshot` (10→0) — e `tailwind.config.ts`/`pdf-extract`.
2026-08-06: o resto — `cooling-leads` (25→0), `kommo-dashboard/index.ts`+
`pure.ts` (24→0), `_shared/kommo-client.ts` (5→0), `kommo-actions` (4→0),
`_shared/paginate.ts` (2→0), `kommo-admin-users` (1→0) no backend;
`settings/DashboardSettings.tsx` (26→0), `Integrations.tsx` (8→0),
`settings/AiSettings.tsx` (7→0) + ~15 arquivos menores no frontend. Achados
relevantes dessa leva final: 3 arquivos `_shared/*` sem "ghl" no nome eram
GHL puro (movidos pro `ghlAndLegacyIgnores`, ver seção acima);
`src/integrations/supabase/types.ts` estava desatualizado há 5 tabelas
(regenerado via `supabase gen types`), o que também zerou boa parte dos `any`
do frontend sem tipagem manual; `kommo.leads.source` nunca é lido pelo
`kommo-dashboard` (fallback morto, comportamento preservado, decisão de
corrigir fica pendente). Gate de lint da CI (Fase 1) agora é **bloqueante**
(`continue-on-error` removido em `.github/workflows/ci.yml`).

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

**Fase 4 concluída (2026-08-06):** decisão tomada — fixtures sintéticas (não
snapshot de chamada real). As 7 closures restantes do `serve()`
(`safeRate`, `isWonLead`, `stageBucket`, `buildDist`, `cycleDays`,
`computeTimePerStage`, `countCurrentlyIn`, `countPassedThrough`) foram
extraídas pra `kommo-dashboard/pure.ts` com parâmetros explícitos
(`leads`, `eventsByLead`, `bucketOf` em vez de capturados do escopo). Em
`index.ts`, `isWonLead`/`stageBucket` viraram wrappers locais finos que fecham
sobre `bucketOf` (evita reescrever os ~9 pontos de chamada espalhados pelo
arquivo). 30 testes no total em `pure.test.ts`, todos rodados de verdade e
passando de primeira — inclusive os cálculos mais delicados
(`computeTimePerStage`, `cycleDays`) com valores calculados à mão. Zero mudança
de comportamento (`deno check` limpo em todas as 10 edge functions Kommo,
`npm run lint/typecheck/test` verdes). Efeito colateral bom: tipar
`DashboardLead`/`StageEvent` em vez de `any` durante a extração já reduziu o
lint de `kommo-dashboard/index.ts` de 27 pra 16 erros.

**`pdf-extract` REMOVIDA deste projeto em 2026-08-08** (achados originais de
2026-08-05/06 preservados aqui pelo histórico): tinha `verify_jwt = false` sem
nenhuma checagem de auth, e era código do lado GHL (único chamador real,
`_shared/ghl-enrich.ts`, roda no projeto antigo — `ghl-enrich-attachments`/
`ghl-conversations-sync` nunca foram deployadas aqui). Órfã neste projeto desde
a cópia em bloco de 2026-08-02, sem chamador funcionando. Removida: function
deletada do Supabase (`supabase functions delete pdf-extract`), pasta apagada
do repo, entrada tirada de `supabase/config.toml`, links mortos corrigidos em
`docs/ARCHITECTURE.md`/`docs/CAPABILITIES.md`. Não muda a Regra #1 (a
instância real que o GHL usa continua intacta no projeto antigo).

**RESTANTE do GHL/legado REMOVIDO deste repo em 2026-08-13** (mesmo raciocínio
do `pdf-extract` acima, aplicado ao que sobrou): auditoria confirmou que as 11
edge functions `admin-bootstrap`/`admin-users`/`ai-analyze-v2`/`ai-assistant`/
`ai-insights-generate`/`ghl-conversations-sync`/`ghl-dashboard`/
`ghl-enrich-attachments`/`ghl-manage`/`ghl-messages-sync`/`ghl-sync` formavam
um cluster isolado — só se importavam entre si, nenhuma `kommo-*` dependia
delas (verificado por grep de import real, não só menção em comentário), e
`supabase functions list` no projeto novo confirmou que nenhuma estava sequer
deployada aqui. As páginas frontend que as chamavam (Sugestões, Conversas,
Analista) já tinham sido removidas em 2026-08 anterior (ver `ARCHITECTURE.md`),
deixando o backend órfão. Auditoria também achou 3 arquivos `_shared/*` que a
leva de lint de 2026-08-06 não tinha pego por não terem gerado erro de lint
(`error-reporter.ts`, usado só pelo cluster acima; `media-extractor.ts` e
`webhook-hmac.ts`, sem NENHUM importador — resíduo de webhooks WhatsApp
Stevo/Uazap já removidos antes). Removidos: as 11 pastas de function, 8
arquivos `_shared/` (os 3 achados + `ai-provider.ts`/`ai-usage.ts`/
`dashboard-metrics.ts`/`ghl-enrich.ts`/`ghl-sync.ts`, já mapeados no
`ghlAndLegacyIgnores` do lint), `src/components/dashboard/AIUsageCard.tsx`
(frontend órfão, zero import). Reboque: `ghlAndLegacyIgnores` tirado do
`eslint.config.js` (voltou a lintar o repo inteiro sem exclusão — `npm run
lint` continua 0 erros), exclusão redundante tirada do loop de `deno check` no
CI, `ghlAndLegacy` Set tirado de `scripts/check-auth-guardrail.mjs`, links
mortos corrigidos (sem `href`, texto mantido) em `docs/CAPABILITIES.md`/
`docs/ARCHITECTURE.md`/`docs/AI_DECISIONS.md`, `README.md` corrigido (citava
o project ref do projeto ANTIGO como se fosse o atual — bug de doc
pré-existente, achado nesta auditoria). Nenhum recurso do Supabase foi tocado
(nada estava deployado aqui pra remover) — não conflita com a Regra #1, que
protege o projeto antigo, intacto. Validado antes e depois: `npm run
typecheck/test/lint` verdes, `deno check` limpo nas 10 functions Kommo
restantes, `deno test` (42 testes) verde, `node scripts/check-auth-guardrail.mjs`
OK.

**`kommo.leads.source` REMOVIDA em 2026-08-08** (achado original de 2026-08-06
preservado pelo histórico): a coluna existia com o comentário "origem derivada
de UTM/origem do lead", e o `kommo-dashboard` tinha um fallback morto pra ela
(nunca lida no SELECT). Ao investigar pra decidir se valia corrigir, descobrimos
que a premissa do achado original estava errada: a coluna **nunca foi populada
de verdade** — o `kommo-sync` sempre gravava `source: null` (funcionalidade de
origem automática começada e nunca terminada), então não existia dado real
sendo perdido. Como a origem do lead já é coberta por "Origem do lead" (custom
field configurável) + os 5 campos de UTM — todos já lidos corretamente —, não
havia motivo pra terminar a funcionalidade. Removida a coluna (migration
`20260808120000_kommo_drop_dead_leads_source.sql`, aplicada via
`supabase db query --linked`) e o `source: null` morto no `kommo-sync`
(redeployado). `types.ts` regenerado.

**`supabase db push` estava QUEBRADO no projeto novo — CONSERTADO em
2026-08-10.** Causa raiz confirmada: a tabela de histórico de migrations
(`supabase_migrations.schema_migrations`) parou de ser atualizada em
2026-06-15 (herança da replicação em bloco de 2026-08-02), mas as 31
migrations `kommo_*` seguintes (17/jun a 08/ago) continuaram sendo aplicadas
manualmente via `supabase db query --linked` sem nunca registrar isso na
tabela de histórico — então `db push` achava que precisava reaplicar tudo do
zero e quebrava em `relation already exists`. Auditoria em 2026-08-10 verificou
o conteúdo real (não só a existência) de todas as 31 migrations não
registradas — tabelas, colunas, funções, índices e triggers de cada uma foram
checados um a um contra o banco de produção, todos batendo — antes de rodar
`supabase migration repair --status applied --linked <31 versões>` (comando
que só corrige a tabela de histórico; não executa SQL nenhum). Validado com
`supabase migration list --linked` (todo `local`/`remote` batendo) e
`supabase db push --linked --dry-run` (`"Remote database is up to date"`).
**`db push` volta a funcionar normalmente pra migrations novas** — não é mais
necessário aplicar na mão via `db query --linked`, embora esse caminho continue
válido como alternativa se preferir.

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

## Métricas Personalizadas — semântica do numerador "passou por" (decisão de 2026-08-10)

Discussão com o usuário sobre a conta "Dr. Eduardo Townsend" (métrica "Não
compareceu (Agendamento)"): o numerador de uma Métrica Personalizada usa
`countPassedThrough` (`supabase/functions/kommo-dashboard/pure.ts`) — conta
lead que está **atualmente** na etapa OU que teve, em qualquer momento do
histórico (`kommo.lead_stage_events`), um evento de entrada nela. Isso é
diferente de "está agora em" (`countCurrentlyIn`, usado só no denominador) e
foi a causa de uma métrica mostrar 35,3% no Dashboard enquanto a contagem
manual de "quem está lá agora" dava 23,5% — não é bug, é o numerador contando
leads que já passaram pela etapa e desde então avançaram/foram remarcados
(confirmado investigando um lead específico: 2 dos 6 que compunham o
numerador não estavam mais fisicamente na etapa).

**Decisão: manter o comportamento atual, sem mudança de código.** Avaliadas e
descartadas duas mitigações:
- **Tag no Kommo em vez de (ou além d)a etapa de funil** — permitiria corrigir
  manualmente um erro de movimentação (tag é removível; evento de etapa não
  é). Descartada porque exigiria 3 peças de infra que não existem hoje
  (automação de tag no Kommo, sync de tags pro nosso banco — `kommo-sync` não
  traz tags — e extensão do schema de Métricas Personalizadas pra aceitar tag
  como referência, hoje só aceita par funil+etapa). Só compensaria se erro de
  movimentação fosse frequente; usuário confirmou que não é (só move pra
  "Não compareceu" quem realmente faltou).
- **Filtro por duração mínima na etapa** (evitar contar passagens de
  1-2 segundos, como vimos num lead de teste/demo que flapou entre 6 etapas
  em minutos) — mesma conclusão: não compensa sem um problema real
  observado no fluxo de produção do usuário.

**CORRIGIDO em 2026-08-10** (revisão da decisão acima, mesmo dia): ao
reexaminar o caso concreto ("Dr. Eduardo Townsend", métrica "Não compareceu
(Agendamento)": numerador 3/histórico, denominador 9/atual → 33,3%, destoando
da contagem manual "quem está lá agora" que dava 23,5%), o usuário concluiu
que misturar as duas réguas na mesma divisão é inconsistente por definição
(não só "confuso") — se o numerador conta em modo funil de passagem
(histórico), o denominador tem que contar do mesmo jeito, senão a % divide
duas fotos tiradas em critérios diferentes. Corrigido em
`supabase/functions/kommo-dashboard/index.ts` (função `customMetrics`): o
denominador do formato `percent` trocou de `countCurrentlyInPure` pra
`countPassedThroughPure` (mesma função já usada no numerador), alinhando com
o que `kommo-report-snapshot` (`leadReachedAnyOf`, usado nos dois lados de
`customPassed`/`customBase`) já fazia certo. `countCurrentlyIn` (`pure.ts`)
ficou sem uso em produção depois disso — mantida como função pura testada
(`pure.test.ts`), não removida. Fica pendente/decidido separadamente: se
"passou por" deveria exigir um tempo mínimo parado na etapa antes de contar
(evita inflar com movimentações rápidas/erros corrigidos na hora) — avaliado
de novo nesta mesma conversa e **mantido sem filtro de tempo** (qualquer
entrada já conta), mesma conclusão da avaliação anterior de 2026-08-10 por
falta de problema real recorrente. `deno check`/`deno test` (33 testes,
`pure.test.ts`) rodados e verdes depois da mudança.

Se essa conversa for revisitada de novo (ex.: usuário reportar % de Métrica
Personalizada que ainda parece destoar de uma contagem manual), comece
verificando se numerador e denominador estão usando a MESMA função de
contagem (`countPassedThroughPure` nos dois lados) antes de assumir bug —
essa já foi a causa raiz duas vezes.

## Filtro de funil do Dashboard — prioridade padrão-vs-seleção manual (decisão de 2026-08-10)

Achado por UX: selecionar um funil manualmente no Dashboard, ir em
"Personalizar" (Configurações) e voltar fazia o filtro reverter pro(s)
funil(is) padrão do workspace (`dashboard_settings.default_pipeline_ids`,
"Funis do Dashboard" em Configurações), perdendo a seleção manual. Não era
bug de estado se perdendo — era a regra "o(s) funil(is) padrão vencem na
abertura" (`src/hooks/useDashboardFilterHydration.ts`, comentário original
"sempre tem prioridade na abertura") disparando de novo, porque `/dashboard`
e `/settings/dashboard` são rotas lazy separadas (`src/App.tsx`) que
desmontam/remontam o componente — cada remount era tratado como "abertura".

**Decisão:** o padrão só deve vencer na 1ª abertura de cada ABA do navegador
(sessão), não em todo remount por navegação interna. Implementado via
`sessionStorage` (não `localStorage`, de propósito — deve voltar a valer se
a pessoa fechar a aba e abrir de novo depois): `defaultPipelineAppliedKey`
em `src/lib/dashboard-filters-storage.ts`, checado/gravado em
`useDashboardFilterHydration.ts` (guarda `defaultPipelineIds = []` se a flag
`dashboard:defaultPipelineApplied:{workspaceId}` já estiver `"1"` nesta aba).
Alternativa descartada: "seleção manual sempre vence, nem em refresh de
página" — usuário preferiu a regra baseada em sessão, mantendo o padrão útil
pra quem nunca mexeu no filtro. Deep link via URL (`?pipelines=...`) não é
afetado — já ignorava o padrão antes desta mudança. `tsc --noEmit` e
`eslint` rodados nos dois arquivos, limpos.

**Limite de 3 Métricas Personalizadas (`MAX_CUSTOM_METRICS`, decisão de
2026-08-10):** hoje é conservador de propósito, não um teto pensado a partir
do espaço visual — o Dashboard já corta em 8
(`data.customMetrics?.slice(0, 8)` em `src/pages/Dashboard.tsx`), o dobro do
permitido. O motivo de manter em 3 é custo computacional: cada métrica entra
no backfill do `kommo-report-snapshot` (recalculado por mês × por vendedor),
então subir o limite multiplica esse custo por workspace. **Pode ser
aumentado quando alguém esbarrar de verdade no limite** (ex.: tentar
configurar uma 4ª métrica) — é uma mudança pequena e reversível
(`MAX_CUSTOM_METRICS` em `src/lib/custom-metrics.ts` +
`CustomMetricsListSchema`/`.max(3)` em `supabase/functions/_shared/schemas.ts`),
mas antes de subir vale reavaliar o custo real do backfill no Relatório com o
número novo, não só trocar a constante.

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
>
- 2026-08-10 (`20260810170000_kommo_workspace_notes.sql`): **nova tabela**
  `kommo.workspace_notes` — página "Anotações" (`/anotacoes`, fora de
  `/settings/*`), bloco de notas mensal para o usuário registrar o que foi
  combinado/observado na reunião mensal (pontos bons/ruins), sem nenhuma
  relação com dashboard/relatório/leads — feature isolada, fase de teste.
  Colunas: `title`, `content jsonb` (doc do editor rich text Tiptap, novo em
  `package.json`: `@tiptap/react`/`@tiptap/pm`/`@tiptap/starter-kit`),
  `reference_month date` (mês da reunião, sempre dia 1 — permite mais de uma
  nota por mês). CRUD direto do frontend via `supabase-js`/RLS (mesmo padrão
  de `kommo.dashboard_settings`: membros leem/inserem/atualizam/excluem,
  service_role tudo), sem edge function. Aditiva; RLS nova por `workspace_id`.
  _(APLICADA em prod 2026-08-10 via `supabase db push --linked`; `types.ts`
  regenerado; `deno check` n/a — não toca em edge functions.)_ **Bug achado e
  corrigido no mesmo dia** (usuário reportou "não está sendo possível
  salvar"): a FK original de `created_by` apontava pra `kommo.profiles(id)`,
  mas essa coluna é um uuid próprio da tabela (o vínculo com o usuário logado
  é via `profiles.user_id`) — o frontend grava `auth.users.id` (o `user.id`
  real da sessão), então todo insert violava a constraint. Corrigido em
  `20260810180000_kommo_workspace_notes_fix_created_by_fk.sql` (dropa a FK;
  `created_by` vira coluna solta, mesmo padrão de
  `kommo.dashboard_analyses.user_id`). Também nesta leva: o editor rico
  (Tiptap, classes `prose`) não aplicava tamanho visual de título (H2/H3) —
  `@tailwindcss/typography` já estava como dependência no `package.json` mas
  nunca tinha sido registrado no array `plugins` de `tailwind.config.ts`;
  adicionado.

> **Verificação mecânica (Fase 0, 2026-08-06):** `node scripts/check-schema-drift.mjs`
> compara essa lista (espelhada em `scripts/kommo-schema-manifest.json`, junto com
> funções/RPCs e os 3 crons do Kommo) contra o banco real, via `supabase db query
> --linked`. Roda só localmente (precisa das credenciais do projeto, mesmo motivo
> do E2E ficar fora da CI — ver `.github/workflows/ci.yml`). Rodar antes de
> releases maiores ou sempre que desconfiar que o CLAUDE.md ficou pra trás — foi
> assim que o drift de URL dos crons (2026-08-05) e as 3 tabelas faltando no
> inventário foram achados manualmente, antes de existir esse script.

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
| `kommo.workspace_notes` | Bloco de notas mensal do usuário (ata de reunião: pontos bons/ruins, combinados) — sem relação com métricas/leads, só texto livre (rich text, doc JSON do Tiptap). `created_by` é `auth.users.id` solto (sem FK — ver changelog 2026-08-10). Criada em `20260810170000_kommo_workspace_notes.sql` |

Migrations posteriores que mexem no schema `kommo` **sem criar tabelas novas**:

- `20260808150000_kommo_report_snapshot_months_24.sql` — recria só
  `trigger_report_snapshot_all()` trocando `'months', 12` por `'months', 24`.
  Motivo: a comparação "Comparar com: mesmo mês, ano passado" (YoY) no
  Relatório precisa que exista o mês 12 meses antes de cada mês exibido —
  com janela de 12 meses isso nunca tinha base. **APLICADA em produção**
  (confirmado por auditoria direta em 2026-08-10: `trigger_report_snapshot_all()`
  já roda com `'months', 24`; a doc estava desatualizada dizendo o contrário).
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

- 2026-08-08 (sem migration — só `kommo-report-snapshot/index.ts`, deployada em
  produção): carência da trava ("period lock", ver entrada abaixo) deixou de ser
  única (3 dias pros dois eixos) e virou diferenciada por eixo —
  `LOCK_GRACE_DAYS_FECHAMENTO = 3` (Financeiro, por `closed_at`) continua igual,
  `LOCK_GRACE_DAYS_CRIACAO = 60` (Comercial, por `kommo_created_at`) é novo.
  Motivo: a trava de 3 dias travava a safra do mês Comercial cedo demais — a
  maioria dos leads criados no mês ainda está em aberto poucos dias depois do
  mês fechar, então a conversão ficava subestimada pra sempre (célula travada
  nunca mais recalcula sozinha). Meses que já travaram sob a regra antiga de 3
  dias **não destravam retroativamente** — a mudança só vale pra células ainda
  não travadas no momento do deploy (confirmado em teste manual: mês Comercial
  travado sob a regra antiga, ao passar por "Forçar recálculo", volta a ficar
  destravado de verdade quando ainda não passou dos 60 dias sob a regra nova).
  Junto: novo modo de **backfill cirúrgico** no payload da function
  (`backfillMetricIds: string[]`, campo aditivo em `KommoReportSnapshotPayloadSchema`
  em `_shared/schemas.ts`) — permite recalcular SÓ o `customRates` de Métricas
  Personalizadas específicas dentro de células já travadas (célula + cada
  `bySeller`), sem tocar em `leads`/`won`/`lost`/`wonRevenue`/`lostRevenue`/
  `winRate`/`locked_at`/`frozen_at`. Resolve o problema de "métrica nova só
  aparece no mês corrente" sem precisar do "Forçar recálculo" geral (que reabre
  a célula inteira, inclusive won/lost/revenue, e por isso deve ficar reservado
  só pra corrigir erro de configuração — ver `MetricsReportTab.tsx`/
  `custom-metrics.ts`). Disparado automaticamente por
  `DashboardSettings.tsx` → `save()`: compara as Métricas Personalizadas atuais
  contra o baseline salvo anterior (`metricFingerprint`, ignora nome/ícone, olha
  só formato/numerador/denominador/visibilidade no Relatório) e manda só os ids
  que mudaram. Testado manualmente em produção (`dda1bf53-...`): backfill
  preservou `leads`/`won`/`wonRevenue`/`locked_at` e só atualizou `customRates`;
  chamada normal (sem `backfillMetricIds`) confirmada que não toca em célula
  travada (`skippedLocked` incrementa, `updated_at` intocado); "Forçar
  recálculo" continua bypassando a trava normalmente nos dois eixos.
- 2026-08-08 (`20260808160000_kommo_report_snapshots_lock.sql`): adiciona colunas
  `kommo.report_snapshots.locked boolean default false` e `locked_at timestamptz`
  — trava definitiva ("period lock") dos meses do Relatório: uma vez travado, o
  `kommo-report-snapshot` nunca mais recalcula aquela célula, mesmo que um lead
  reabra depois. Trava acontece 3 dias após o fechamento do mês OU a conexão do
  workspace (`kommo.workspaces.created_at`), o que for mais tarde — evita travar
  instantaneamente o histórico inteiro de uma conta que acabou de conectar.
  Acompanha correção em `kommo-sync` (sem migration): backfill de
  `lead_stage_events` passou de teto por CONTAGEM (1.500, imprevisível) pra teto
  por DATA (24 meses, alinhado com `REPORT_SNAPSHOT_MONTHS`), com aviso em
  `sync_status.last_sync_warning` quando mesmo essa janela não couber numa
  passada (antes não avisava nada). Aditiva; sem mudança de RLS. **APLICADA em
  produção** (confirmado por auditoria direta em 2026-08-10: colunas `locked`/
  `locked_at` já existem em `kommo.report_snapshots`; a doc estava desatualizada
  dizendo o contrário — o rollout faseado descrito abaixo já foi concluído).
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
