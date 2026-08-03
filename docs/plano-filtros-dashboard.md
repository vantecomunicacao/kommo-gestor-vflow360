# Sistema de filtro do Dashboard — mapa, bugs corrigidos e próximas fases

## Contexto

O Dashboard e os Relatórios têm filtros (funil, etapa, vendedor, UTM, origem, período)
espalhados por vários arquivos sem um contrato único — cada campo novo precisava ser
lembrado manualmente em ~5 lugares diferentes (tipo, hidratação/persistência, query
key do React Query, corpo da chamada à edge function, componente de UI). Essa falta de
contrato único já causou dois bugs reais em produção (ver abaixo). Este documento existe
para servir de referência viva: sempre que um filtro novo for adicionado, atualize a
tabela da seção 1 na mesma alteração — ela é a fonte de verdade, não deixe divergir do
código (mesmo espírito da tabela de tabelas do `kommo` schema em `CLAUDE.md`).

## 1. Mapa do contrato de filtro (estado atual)

| Filtro | Tipo de estado | Onde vive (frontend) | Componente de UI | Campo no body da edge function |
| --- | --- | --- | --- | --- |
| Período (`dateRange`) | `DateRange \| undefined` | `Dashboard.tsx` | `DateRangePicker` (`Header.tsx`) | `startDate`, `endDate` (ISO) |
| Eixo de data (`dateBasis`) | `"criacao" \| "fechamento"` | `Dashboard.tsx` | `AxisTabs` | `dateBasis` |
| Funil (`selectedPipelineIds`) | `string[]` (multi) | `Dashboard.tsx` | `MultiFilterSelect` | `pipelineId` (aceita string única OU array, sempre normalizado pra array no servidor) |
| Etapa (`selectedStageIds`) | `string[]` (multi) | `Dashboard.tsx` | `MultiFilterSelect` — só aparece com **exatamente 1** funil selecionado | `stageIds` |
| Vendedor (`selectedSellerIds`) | `string[]` (multi) | `Dashboard.tsx` | `MultiFilterSelect` | `sellerIds` |
| Tipo de origem / UTM Medium (`selectedUtmMediums`) | `string[]` (multi) | `Dashboard.tsx` | `MultiFilterSelect` | `utmMedium` |
| Campanha / UTM Campaign (`selectedUtmCampaigns`) | `string[]` (multi) | `Dashboard.tsx` | `MultiFilterSelect` | `utmCampaign` |
| Origem (`selectedOrigins`) | `string[]` (multi) | `Dashboard.tsx` | `MultiFilterSelect` | `origin` |

Contagem de filtros ativos (`activeFilterCount`, badge do botão "Filtros" no mobile):
derivada automaticamente desses mesmos campos em `countActiveFilters()`
(`src/lib/dashboard-filters.ts`) — um filtro novo que entrar nessa função já é contado
sem precisar tocar em `Header.tsx`.

**Arquivos que compõem o contrato hoje:**
- `src/hooks/useKommoData.ts` — tipo `DashboardFilters`, monta a `queryKey` do React
  Query e o corpo HTTP enviado pra `kommo-dashboard`. Todo filtro novo precisa entrar
  nos dois lugares (queryKey **e** body) — são independentes, um não implica o outro.
- `src/pages/Dashboard.tsx` — estado (`useState`), hidratação/persistência em
  `localStorage` (`SavedFilters`, chave `dashboard:filters:<workspaceId>`), e o objeto
  `filters` passado pro hook.
- `src/components/dashboard/Header.tsx` — UI dos filtros (usa
  `src/components/filters/FilterSelect.tsx` e `MultiFilterSelect.tsx`, extraídos daqui
  porque `src/pages/Reports.tsx` também os importa — antes eram acoplados dentro do
  arquivo de página do Dashboard).
- `supabase/functions/kommo-dashboard/index.ts` — parseia o body (`payload.*`) e aplica
  cada filtro na query de `leads`.

**Fora desse contrato, por design:** `src/pages/Reports.tsx` tem seus próprios filtros
(funil em seleção única, vendedor multi) porque consome `report_snapshots` (fotos
mensais pré-computadas por funil), não os dados ao vivo do Dashboard — ver seção 4.

## 2. Bugs corrigidos (causa raiz)

### 2.1 — Filtro de UTM nunca filtrava de verdade

`useKommoData.ts` já enviava `utmMedium`/`utmCampaign` no corpo da chamada, e a edge
function `kommo-dashboard` já os lia do `payload` — mas só usava esses valores pra
**calcular o field id configurado** (`utm_medium_field_id`), nunca pra de fato filtrar
o array de `leads`. Resultado: selecionar um valor no dropdown mudava a aparência do
botão (borda azul, contagem no badge), mas os números do dashboard nunca mudavam.
Corrigido aplicando o filtro (`leads.filter(...)`) antes das agregações.

### 2.2 — Funil arquivado/deletado podia vazar dado

A query de leads aplicava `filterPipelineId` direto (`q.eq("pipeline_id",
filterPipelineId)`) sem checar se esse id ainda estava entre os funis vivos
(`is_archive=false`, `is_deleted=false`, ver migration
`20260727180000_kommo_pipelines_is_deleted.sql`). Um `pipelineId` salvo no
`localStorage` de antes dessa migration — de um funil já arquivado/apagado no Kommo —
continuava filtrando normalmente, trazendo de volta dado de um funil morto. Corrigido
validando o(s) `pipelineId(s)` recebido(s) contra `allPipelines` (só funis vivos) antes
de aplicar o filtro; ids que não existem mais são tratados como "sem filtro".

## 3. Duplicação disciplinada: bucket de funil (frontend ↔ edge)

`src/lib/dashboard-funnel.ts` (frontend, usado em Configurações e no preview de
mapeamento) e `supabase/functions/_shared/kommo-funnel.ts` (edge, usado no cálculo
real) implementam a **mesma regra de prioridade** — chave nova `"<pipeline>:<etapa>"`
vence a legada `"<etapa>"` (que vale pra qualquer funil) — mas não podem compartilhar
o mesmo arquivo `.ts` porque rodam em runtimes diferentes (browser/Vite vs Deno), sem
um pacote compartilhado configurado no build. Decisão consciente: manter a duplicação,
mas alinhada defensivamente — `readStageBucket()` (frontend) valida o valor contra
`FUNNEL_BUCKETS` e normaliza o separador da chave legada do mesmo jeito que
`parseFunnelMapping()` (edge) já fazia, com comentário cruzado nos dois arquivos
apontando um pro outro. Se a regra mudar, replicar nos dois — não há proteção
automática (tipo teste compartilhado) contra esquecer um dos lados.

## 4. Fase 5 — URL params (deep link) no Dashboard

Filtros do Dashboard sincronizados com a query string via `useSearchParams`
(react-router-dom; primeira vez que esse hook é usado no projeto). Params:
`pipelines`, `stages`, `sellers`, `utmMedium`, `utmCampaign`, `origin` (arrays
separados por vírgula), `axis` (= `dateBasis`), `from`/`to` (ISO `yyyy-MM-dd`).

**Precedência na abertura:** se a URL tiver qualquer um desses params, ela vence —
inclusive sobre o funil padrão do workspace (`default_pipeline_ids`), porque um link
compartilhado é uma intenção explícita de quem gerou o link. Sem esses params na URL,
o fluxo continua igual a antes (localStorage → funil padrão → reset). Daí em diante, a
URL é mantida como espelho do estado atual (`setSearchParams(..., { replace: true })`,
sem empilhar histórico de navegação a cada clique de filtro) — o `localStorage`
continua sendo o mecanismo de "lembrar a última visão" entre sessões; a URL é só um
jeito de compartilhar/copiar uma visão específica.

**Escopo:** só o Dashboard. Relatórios não ganhou isso (não foi pedido, e o modelo de
filtro lá é diferente — ver seção 6).

## 5. Fase 6 — Validação zod nas edge functions

`supabase/functions/_shared/schemas.ts` (novo) define, com `zod` (importado via
`https://esm.sh/zod@3.23.8`, mesmo padrão de import por URL já usado no projeto —
`pdf-extract` importa `unpdf` da mesma forma, não há `npm:` nem `import_map.json` no
repo), os schemas `KommoDashboardPayloadSchema` e `KommoReportSnapshotPayloadSchema`.
Eles **espelham exatamente** a validação manual que já existia (campos obrigatórios,
arrays normalizados, defaults tolerantes como `dateBasis` caindo em `"criacao"` e
`months` clampado 1–36) — a intenção não foi apertar a validação, foi só formalizar
numa única definição por function, em vez de casts `as any` e `Array.isArray(...) &&
filter(...)` espalhados. Erros de validação (`z.ZodError`) retornam 400 com mensagem
clara, em vez de cair no catch genérico (500) que existia antes.

**Isso muda o contrato de leitura do body das 2 edge functions — exige redeploy pra
valer** (mesmo processo das fases anteriores: mostrar o que vai ser deployado e pedir
confirmação antes).

## 6. Por que os Relatórios (`/relatorios`) ficam de fora

`useReportSnapshots` lê `kommo.report_snapshots` — fotos mensais **pré-computadas**
por `(workspace, pipeline_id, mês, eixo)`, não uma consulta ao vivo. O filtro de funil
lá é seleção única (`pipelineId: string | null`, sentinel `"__all__"` só no limite com
essa tabela) porque cada linha da tabela já corresponde a um funil específico (ou ao
agregado `"__all__"`). Multi-seleção arbitrária de funis nos Relatórios é viável (dá
pra somar várias linhas por mês, igual já se faz hoje com `bySeller`), mas é trabalho
adicional não coberto neste plano — registrado aqui como próximo passo natural, se
algum dia for pedido.
