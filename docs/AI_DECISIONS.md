# Decisões de IA — onde o LLM realmente decide

> Só existe **um ponto de decisão por LLM** que importa no sistema: a análise de
> conversa que gera sugestões (`ai-analyze` / `ai-analyze-v2`). Este doc descreve
> esse ponto como ele é hoje — entradas, gates, prompt, contrato de saída,
> guardrails e o fluxo de aprovação — e marca as decisões em aberto.
>
> Referência de código: `ai-analyze-v2/index.ts`
> (2.0, GHL). O 1.0 (`ai-analyze`) tem a **mesma lógica de prompt/validação**, só
> muda a camada de dados. Atualizado em 2026-06-03.

---

## 1. A decisão, em uma frase

Dada uma conversa, o LLM propõe de 0 a N ações de CRM, escolhidas de um **menu
fechado de 6 tipos**, cada uma justificada por um trecho da conversa. Ele **não
executa nada** — só grava em `suggestions`.

## 2. Gates ANTES de chamar o LLM (controle de custo e escopo)

A chamada paga ao LLM só acontece depois de passar por todos estes filtros. Se
algum barra, a função limpa o debounce e retorna sem custo. Em ordem:

1. **Auth** — service role / anon (cron) / authenticated (admin ou membro do workspace).
2. **Debounce guard** — se `analyze_after` foi empurrado pro futuro por mensagem mais nova, pula.
3. **Workspace** — `ai_analysis_enabled` ligado e não deletado.
4. **Contato desabilitado** — `disabled_contacts` por workspace/telefone.
5. **Filtro de pipeline** — se `ghl_dashboard_settings.ai_allowed_pipeline_ids` estiver setado, o lead precisa ter oportunidade num pipeline permitido.
6. **Mensagens** — precisa haver ao menos 1 mensagem com conteúdo (`coalesce(enriched_body, body)`).
7. **Ações habilitadas** — ao menos um tipo de ação `enabled` em `ai_config`, e que tenha config necessária (mover_funil exige `selectedStages`; campo_personalizado exige `selectedFields`).

> Esses gates são o que mantém o "cérebro" barato e sob controle. Toda decisão de
> *quando não pensar* é determinística e fica fora do LLM.

## 3. Entradas da decisão (o que o LLM recebe)

| Entrada | Origem |
|---|---|
| Conversa (últimas **20 mensagens**, ordenadas) | `ghl_messages` (`enriched_body` ou `body`) |
| Prompt customizado do workspace | `integrations.config.aiPrompt` (GHL) |
| Campos do CRM permitidos | `integrations.config.selectedFields` |
| Etapas de funil permitidas | `integrations.config.selectedStages` |
| Motivos de perda | **fetch ao vivo** no GHL (`/opportunities/lost-reason`) |
| Sugestões anteriores (últimas 5) | `suggestions` (para não repetir/contradizer) |
| Data/hora atual (America/Sao_Paulo) | injetada no prompt |

## 4. O prompt

O system prompt é **montado em código** (`ai-analyze-v2/index.ts`, ~linha 403). Tem
uma parte fixa (regras obrigatórias, formato) e uma parte dinâmica (campos, etapas,
tipos de ação ativos, sugestões anteriores, `aiPrompt` do workspace).

Regras embutidas mais relevantes (resumo):
- Só sugerir com **evidência clara** na conversa; na dúvida, não sugerir.
- Para `mover_funil`/`campo_personalizado`: usar **apenas** etapas/campos da lista (pela `fieldKey`); nunca inventar.
- Para `valor_negociacao`: sempre o **valor total** (multiplica parcelas), só número.
- Para `agendar_lembrete`: `due_date` em ISO 8601 `-03:00`, sempre no futuro.
- Para `ganho_perdido` "perdido": **obrigatório** `lost_reason_id` da lista do CRM.
- Nunca gerar contradições no mesmo lote (ganho **e** perdido).

> ⚠️ **Lacuna: o prompt não é versionado.** Ele vive no código da function; a única
> "versão" gravada na sugestão é `ai_provider` (= `openai/gpt-4o-mini`), que é o
> **modelo**, não a versão do prompt. Isso impede atribuir mudança de comportamento
> a uma mudança de prompt depois. Ver Decisão #2.

## 5. Modelo e provider

- Provider/modelo resolvidos de `ai_provider_config` (por owner do workspace); default **`gpt-4o-mini`**.
- Chave: a do workspace, com fallback para `OPENAI_API_KEY` global.
- Chamada via **OpenAI tool calling** com `tool_choice` forçado (`suggest_crm_actions`) — a saída é estruturada por schema, não texto livre.

## 6. Contrato de saída (o "menu fechado")

A tool `suggest_crm_actions` retorna `suggestions[]`, cada uma com `type` (enum
restrito aos tipos ativos), `title`, `description` (com trecho que justifica), e
campos opcionais `field`, `value`, `task_title`, `due_date`, `lost_reason_id`.

Os 6 tipos e o que cada um vira no GHL ao executar estão em
[`CAPABILITIES.md` §C1](./CAPABILITIES.md). `required: [type, title, description]`.

## 7. Guardrails APÓS o LLM (a saída não é confiada cegamente)

Antes de gravar, a saída passa por:
1. **Normalização de tipo** (`LEGACY_TYPE_MAP`) — descarta tipos fora do enum.
2. **Validação de campo/etapa** — descarta `mover_funil`/`campo_personalizado` com valor fora da lista permitida.
3. **Contradição no lote** — se vier ganho **e** perdido, remove ambos.
4. **Dedup vs anteriores** — descarta repetição (`tipo:campo:valor`) e título similar (≥60% de palavras em comum) a sugestões já existentes; descarta o que contradiz uma já **aprovada**.

> Esse pós-processamento é tão importante quanto o prompt: é o que impede a IA de
> poluir a fila do gestor com lixo/duplicata. Mudanças aqui afetam comportamento
> tanto quanto mudar o prompt.

## 8. Fluxo de aprovação (o ponto humano)

- Sugestão nasce `pending` → gestor aprova/edita/rejeita na página `Suggestions`.
- Ao aprovar, a execução no GHL roda via `ghl-manage` e o resultado volta para `action_data` (`executed`, `execution_result`, `executed_at`).

### O `auto_approve`, esclarecido
`ai_config` tem `auto_approve` por tipo de ação. Quando ligado:
- **No 2.0:** a sugestão é gravada já como `approved`, **mas a execução NÃO dispara
  automaticamente** (exigiria edge→edge para `ghl-manage`, que falha aqui — ver
  [[feedback_edge_fn_no_http]]). Ou seja, hoje no 2.0 "auto-approve" = pula a
  revisão humana mas ainda depende do fluxo/UI para executar de fato.
- **No 1.0:** verificar se há auto-execução (o webhook tem caminho próprio).

## 9. Custo — já é logado

Cada chamada grava em **`ai_usage_log`**: `prompt_tokens`, `completion_tokens`,
`total_tokens`, `cost_usd` (tabela de preços embutida por modelo), por workspace.
Essa é a primeira peça de observabilidade de IA que **já existe**. O que falta
(qualidade, não custo) está em `OBSERVABILITY.md` (a escrever).

## 10. Decisões em aberto

### Decisão #1 — `auto_approve` vs. "somente o que for aprovado"
Objetivo declarado: nada executa sem aprovação. Hoje `auto_approve` pula a revisão
humana (marca `approved`). Opções:
- **(a)** Desligar `auto_approve` de vez → toda ação passa pelo gestor.
- **(b)** Mantê-lo como **pré-autorização explícita por tipo** (gestor liga ciente do risco), documentando que tipos "seguros" (ex: `adicionar_nota`) podem auto-aprovar e tipos "fortes" (ex: `ganho_perdido`, `mover_funil`) nunca.
- **(c)** Manter como está (no 2.0 ele já não executa sozinho).

### Decisão #2 — Versionar o prompt → **RESOLVIDA (2026-06-07)**

Cada sugestão agora registra a versão do prompt que a gerou, espelhando o que o
cérebro analítico já fazia (`ai_insights.prompt_version`):

- Coluna `suggestions.prompt_version` (migration `20260607170000_suggestions_prompt_version.sql`).
- Constante `PROMPT_VERSION` em `ai-analyze-v2`, gravada no insert.
- **Convenção:** dar bump em `PROMPT_VERSION` SEMPRE que mudar o system prompt **ou**
  qualquer guardrail pós-LLM (normalização, dedup, contradição). Sugestões antigas
  ficam `null` (= geradas antes do versionamento).

### Decisão #3 — Unificar 1.0 e 2.0 ou manter clones
`ai-analyze` e `ai-analyze-v2` são clones com lógica de prompt/validação idêntica e
camada de dados diferente. Risco: divergirem com o tempo. Opção: extrair o núcleo
(prompt + guardrails) para `_shared/` e deixar cada function só com sua camada de
dados. (Não urgente — o 1.0 é o sistema vivo principal, ver [[project_evolution_still_primary]].)
