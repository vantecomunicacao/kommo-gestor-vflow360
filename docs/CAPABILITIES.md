# Catálogo de Capacidades

> O que o sistema **sabe fazer**, capacidade por capacidade.

---

## 0. ESTADO ATUAL — Fase 1 (Kommo) · atualizado 2026-07-07

> **Leia primeiro.** O catálogo A–G abaixo é da **geração GHL** (copiloto de IA por
> conversa). É **histórico/roadmap**. As capacidades **vivas no produto Kommo** são:

| # | Capacidade (Kommo, Fase 1) | Tipo | Function |
|---|---|---|---|
| K1 | Conectar/validar integração Kommo (token no Vault) | Determinística | `kommo-manage` |
| K2 | Snapshot do CRM → schema `kommo` (incremental) | Determinística | `kommo-sync` |
| K3 | Dashboard de funil/velocidade/ciclos/origens/follow-up | Determinística | `kommo-dashboard` |
| K4 | Leads esfriando (inatividade por `kommo_updated_at`) | Determinística | `cooling-leads` |
| K5 | Bootstrap/gestão de usuários e workspace/membros | Determinística | `kommo-admin-*` |

**Nenhuma capacidade de IA está viva na Fase 1.** O copiloto (gerar sugestões, analisar
conversa, analista do conjunto) é **Fase 2**, condicionada a validar a API de conversas
do Kommo — ver `ROADMAP_FASE2_COPILOTO.md`. O schema `kommo` não tem conversas/mensagens.

---

# HISTÓRICO — capacidades da geração GHL (base da Fase 2)

> O catálogo A–G a seguir descreve o copiloto GHL/Evolution/Stevo. Mantido como
> referência e insumo da Fase 2. **Não** reflete o produto Kommo atual.

---

## Legenda

- **Tipo** — `Determinística` (sem LLM) · `IA` (LLM decide) · `Humano` (gestor decide)
- **Custo** — chamadas pagas/externas por execução (LLM, GHL API, etc.)

---

## A. Ingestão de conversa

### A1. Receber mensagem de WhatsApp (1.0)
- **Trigger:** webhook do provedor (`evolution-webhook`, `stevo-webhook`, `stevo-oficial-webhook`)
- **Input:** payload do provedor (texto/mídia) · **Output:** linha em `conversations`/`messages`
- **Efeitos:** extrai mídia (`_shared/media-extractor`), seta `analyze_after` (debounce)
- **Custo:** download de mídia · **Tipo:** Determinística

### A2. Sincronizar lista de conversas do GHL (2.0)
- **Trigger:** cron `*/10` (`trigger_ghl_v2_sync_all`) ou UI
- **Input:** `{ workspace_id, full? }` · **Output:** upsert em `ghl_conversations`
- **Efeitos:** "heat" por inbound novo (seta `analyze_after`), enrich de mídia inline, atualiza `ghl_sync_watermarks`. Mensagens NÃO entram aqui (lazy — ver A3).
- **Custo:** GHL API (paginado por watermark) · **Tipo:** Determinística
- **Function:** `ghl-conversations-sync`

### A3. Sincronizar mensagens de uma conversa (2.0)
- **Trigger:** UI (abrir conversa) ou pré-análise
- **Input:** `{ workspace_id, ghl_conversation_id, max_messages? }` · **Output:** upsert em `ghl_messages`
- **Efeitos:** atualiza `messages_synced_until` · **Custo:** GHL API · **Tipo:** Determinística
- **Function:** `ghl-messages-sync`

### A4. Snapshot do CRM (pipelines, oportunidades, campos)
- **Trigger:** cron / UI · **Input:** `{ workspace_id }` (JWT ou service role)
- **Output:** snapshot em `ghl_opportunities`, pipelines, custom_fields, lost_reasons, users
- **Custo:** GHL API · **Tipo:** Determinística · **Function:** `ghl-sync`

## B. Preparo para a IA

### B1. Enriquecer mídia (transcrição / OCR / PDF)
- **Trigger:** inline no sync 2.0, ou `ghl-enrich-attachments` (UI/pré-análise), ou `pdf-extract`
- **Input:** anexo (áudio/imagem/PDF) · **Output:** `enriched_body` na mensagem
- **Efeitos:** o conteúdo da mídia vira texto que a IA consegue ler
- **Custo:** **LLM/transcrição** (chave de IA do workspace) · **Tipo:** IA (auxiliar)
- **Código:** `_shared/ghl-enrich.ts` · `pdf-extract` (removida deste repo 2026-08-08 — era órfã aqui; a instância real do GHL roda no projeto antigo)

## C. Decisão da IA (o "Cérebro")

### C1. Analisar conversa e gerar sugestões
- **Trigger:**
  - 1.0 → `analyze-scheduler` (cron `* * * * *`) drena `analyze_after` vencido
  - 2.0 → `trigger_ghl_v2_analyze_due` (cron `*/2`) reivindica até 50 conversas vencidas
- **Input:** conversa + mensagens (`coalesce(enriched_body, body)`) + config do workspace
- **Output:** 0..N linhas em `suggestions` (status `pending`)
- **Efeitos:** seta `last_analyzed_at`; **inbound aciona, outbound não re-analisa**
- **Custo:** **1 chamada LLM por conversa** · **Tipo:** IA
- **Functions:** `ai-analyze` (1.0) · `ai-analyze-v2` (2.0)

As sugestões que a IA pode gerar são **fechadas** a 6 tipos (o "menu de ações"):

| Tipo | Rótulo | Ação no GHL ao aprovar |
|---|---|---|
| `mover_funil` | Mover funil | Move oportunidade de estágio |
| `campo_personalizado` | Preencher campo | Atualiza custom field |
| `adicionar_nota` | Adicionar nota | Cria nota no contato |
| `valor_negociacao` | Atualizar valor | Atualiza valor monetário |
| `agendar_lembrete` | Agendar lembrete | Cria tarefa/lembrete |
| `ganho_perdido` | Marcar resultado | Marca oportunidade ganha/perdida |

Cada tipo tem toggle `enabled` e `auto_approve` por workspace em `ai_config`.

## C2. Cérebro analítico (analista do conjunto)

> Distinto de C1: C1 olha **uma conversa** e sugere **ação de CRM**. C2 olha o
> **conjunto** (funil + conversas + sugestões) e produz **análise/insight** para o
> gestor. É read-only — não executa nada no GHL. Adicionado em 2026-06-07.

### C2a. Configuração do Analista (por workspace)
- **Onde:** Integrações → bloco "Analista IA" ([`AiAnalystConfig.tsx`](../src/components/integrations/AiAnalystConfig.tsx))
- **Guarda em:** `ghl_dashboard_settings.ai_insights_config` = `{ enabled, combined:{prompt}, pipelines:[{id,prompt}] }`
- **O gestor define:** liga/desliga; quais funis o Analista acompanha; um **foco (prompt) por funil** e um para a **visão combinada**. Prompt vazio → usa o padrão embutido na edge (resetável na UI).
- **Tipo:** Humano (configuração)

### C2b. Gerar insights proativos (semanal, ao vivo)
- **Trigger:** cron `ai-insights-tick` (`30 6 * * 1` = seg 03h30 BRT) · **Input:** `{ workspace_id }`
- **Dados:** análise AO VIVO — `computePeriodMetrics` lê `ghl_opportunities` da **semana atual vs. anterior** (fluxo: criados/ganhos/perdidos/valor; estoque: abertos por etapa + envelhecimento). **Sem snapshot.** + amostra de conversas (na visão combinada).
- **Execução:** **1 rodada de IA por funil marcado** (cada um com seu foco, isolado: gargalo/taxa de ganho/envelhecimento) **+ 1 rodada combinada** (volume/valor dos marcados — **nunca conversão misturada**).
- **Output:** 0..N linhas em `ai_insights` (`kind`, `severity`, `title`, `body`, `period_label`, `refs.pipeline_name`, `prompt_version`). Insights ativos anteriores viram `dismissed`.
- **Gates:** `ai_insights_config.enabled` + ≥1 funil selecionado · **Custo:** ~(nº funis + 1) chamadas LLM por workspace/semana (modelo barato) · **Tipo:** IA
- **Function:** `ai-insights-generate` · métricas em `_shared/dashboard-metrics.ts`

## D. Decisão do humano (aprovação)

### D1. Aprovar / editar / rejeitar sugestão
- **Trigger:** gestor na página `Suggestions` (componente [`SuggestionCard`](../src/components/suggestions/SuggestionCard.tsx))
- **Input:** sugestão `pending` · **Output:** status → `approved` ou `rejected`
- **Efeitos:** ao aprovar, dispara a execução no GHL (E1). O resultado volta para `action_data` (`executed`, `execution_result`, `executed_at`).
- **Custo:** nenhum (humano) · **Tipo:** Humano
- **⚠️ Ponto de decisão:** existe `auto_approve` por tipo — quando ligado, a ação
  executa **sem** revisão item a item. Isso conflita com o objetivo declarado
  "somente o que for aprovado". A decidir em `AI_DECISIONS.md`: manter auto-approve
  como pré-autorização explícita, ou desligar e exigir aprovação manual sempre.

## E. Execução (as "Ferramentas")

### E1. Executar ação aprovada no GHL
- **Trigger:** aprovação de uma sugestão (D1) · **Input:** `action_data` da sugestão
- **Output:** mutação no GHL (mover funil / nota / campo / valor / ganho-perdido) + resultado gravado
- **Efeitos:** pode criar contato/oportunidade se configurado (`allowCreateContact`/`allowCreateOpportunity`)
- **Custo:** GHL API (escrita) · **Tipo:** Determinística (executa o que foi aprovado)
- **Function:** `ghl-manage`

## F. Visualização & gestão

### F1. Dashboard de funil
- **Trigger:** UI · **Output:** `DashboardData` agregado (funil, filtros por período/pipeline/vendedor/origem)
- **Tipo:** Determinística · **Function:** `ghl-dashboard`

### F2. Conectar canal (pareamento de WhatsApp)
- **Trigger:** UI / página pública `/conectar/:token` · **Output:** QR / status da instância
- **Tipo:** Determinística · **Functions:** `evolution-manage` · `evolution-pairing-public`

## G. Observabilidade (fundação de aprendizado — fase 0)

### G1. Registrar eventos / erros
- **Trigger:** front (`log-event`) e edge (`_shared/error-reporter`) · **Output:** `system_logs`
- **Tipo:** Determinística
- **Lacuna conhecida:** ainda não logamos a tripla `input → prompt_version → output →
  decisão do gestor` de forma estruturada. É o que falta para o aprendizado offline.
  Detalhe em `OBSERVABILITY.md` (a escrever).

---

## Resumo: onde a IA realmente decide

De todas as capacidades acima, **só duas envolvem um LLM decidindo**: B1 (enriquecer
mídia, auxiliar) e C1 (gerar sugestões, central). Todo o resto é cron determinístico,
chamada de API, ou decisão humana. Esse é o coração do sistema IA-first — e é o que
o `AI_DECISIONS.md` vai detalhar (prompts, versionamento, ponto de aprovação).
