# Arquitetura — VFlow360 Gestor

> Mapa do território. Visão transversal que **não** existe em nenhum outro lugar do
> repo (a regra de negócio detalhada vive nos comentários das migrations e das
> functions; aqui é o "você está aqui").

---

## 0. ESTADO ATUAL — Fase 1 (Kommo, produto de analytics) · atualizado 2026-08-03

> **Leia isto primeiro.** As seções 1–8 abaixo descrevem a **geração GHL** do sistema
> (Evolution/Stevo/GHL, copiloto de IA por conversa). Elas são **histórico/roadmap** —
> úteis como referência, mas **não** são o que roda no produto Kommo de hoje, e desde
> 2026-08-02 **nem rodam mais no mesmo projeto Supabase** (ver "Isolamento" abaixo).

O sistema está **migrado para o Kommo** e opera como um **painel de gestão/analytics**:

- **Fonte de dados:** CRM Kommo (`/api/v4`) → snapshot local no schema **`kommo`** via
  `kommo-sync` (incremental por `sync_watermarks`; full-scan como fallback).
- **O que existe (Fase 1):** Dashboard de funil, velocidade, tempo por etapa, ciclos,
  origens/UTMs, qualidade de campos, follow-up (tarefas atrasadas), **Leads esfriando**
  (inatividade por `kommo_updated_at`), gestão de workspace/membros, integração Kommo,
  análise de IA sob demanda, relatório mês a mês com snapshots.
- **Edge functions vivas (schema `kommo`):** `kommo-sync`, `kommo-manage`,
  `kommo-dashboard`, `kommo-report-snapshot`, `kommo-actions`, `kommo-ai-analyze`,
  `cooling-leads`, `kommo-admin-bootstrap`, `kommo-admin-users`, `log-event`.
- **Fora do produto (Fase 2, ver `ROADMAP_FASE2_COPILOTO.md`):** o **copiloto de IA**
  (Sugestões, Conversas, Analista) e a observabilidade (Logs/Sistema). O schema `kommo`
  **não tem** conversations/messages/suggestions/ai_config — a IA por conversa depende
  de validar se a API do Kommo expõe o texto das conversas. As páginas/hooks
  correspondentes (`Suggestions`, `Conversations2`, `Assistant`, `SystemHub`,
  `SystemLogs` e afins) foram **removidas do repo em 2026-08** por estarem
  desconectadas de qualquer rota — reviver essa fase é reescrever, não descongelar.
- **Stack:** React 18 + Vite + TS + shadcn/ui + Tailwind + React Query · Supabase
  (Postgres + RLS + Edge Functions Deno) · pg_cron (sync) · Coolify.
- **Isolamento:** desde 2026-08-02 o Kommo roda num **projeto Supabase próprio**
  (`fjncmmqvmocwykpshgsh`, "Kommo VFlow360 Gestor") — não é mais o banco
  compartilhado com o GHL. O app aponta para `db.schema = "kommo"` nesse projeto
  isolado; não há nenhuma tabela/function `ghl_*`/`ghl-*` nele. O projeto antigo
  compartilhado (`xcrfbpyhyznyufijrdry`, onde o GHL ainda roda) segue existindo à
  parte — regras de não-interferência do `../CLAUDE.md` se aplicam a ele. Detalhe
  completo em `../CLAUDE.md` → "Infraestrutura Supabase".
- **Filtros do Dashboard:** contrato de filtro (Funil/Etapa/Vendedor/UTM/Origem, todos
  multi-seleção), deep link via URL params e a validação zod do body das edge
  functions estão documentados em `plano-filtros-dashboard.md`.

---

# HISTÓRICO — geração GHL (referência / base da Fase 2)

> As seções a seguir descrevem a topologia GHL/Evolution/Stevo original. Mantidas como
> registro e insumo para a Fase 2. **Não** refletem o produto Kommo atual.

---

## 1. Em uma frase

Painel para **gestores** (vendedores nunca têm login) que centraliza conversas de
WhatsApp e do GHL, e usa IA para **sugerir** ações comerciais que o gestor aprova.
A IA nunca executa nada sozinha sem que a ação tenha sido autorizada.

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Front | React 18 + Vite + TypeScript + shadcn/ui + Tailwind + React Query |
| Backend | Supabase (Postgres + RLS + Edge Functions em Deno) |
| Agendamento | `pg_cron` + `pg_net` (Postgres chama edge function via HTTP) |
| IA | OpenAI (provider default) — config por workspace em `ai_provider_config` |
| Integrações externas | GoHighLevel (GHL), Evolution API, Stevo, Uazap (desativado) |
| Deploy | Coolify |

## 3. A regra de ouro da topologia

**Postgres → Edge Function (via `pg_net`), NUNCA Edge → Edge.**
Chamada de uma edge function para outra falha silenciosamente neste Supabase. Por
isso o trabalho compartilhado vive em `supabase/functions/_shared/`
e é **inlined** em cada function, não chamado por HTTP. Crons disparam functions
via `net.http_post` com a anon key.

## 4. Os dois mundos (convivem hoje)

O sistema tem **duas gerações de pipeline de conversa rodando em paralelo**. Não as
confunda — têm tabelas, functions e disparos diferentes.

> **Importante:** o **1.0 (Evolution/Stevo) é o sistema vivo principal** em jun/2026
> (centenas de msgs/dia, ~14 conexões). O 2.0 (GHL) cobre só parte do fluxo. 2.0 NÃO
> substitui 1.0 hoje — qualquer remoção do 1.0 seria uma migração validada, não um delete.

### Mundo 1.0 — WhatsApp direto (Evolution / Stevo)
A fonte da verdade é o webhook que chega. Mensagem entra → grava em
`conversations`/`messages` → debounce em `analyze_after` → análise da IA.

```
WhatsApp → [evolution-webhook | stevo-webhook | stevo-oficial-webhook]
              ↓ grava conversations/messages, seta analyze_after (debounce)
         [cron 1min: analyze-scheduler]  ← rede de segurança do debounce
              ↓ dispara
         [ai-analyze]  → grava em suggestions (conversation_id)
```

### Mundo 2.0 — GHL como fonte da verdade (Conversas 2.0)
O GHL é a fonte da verdade; o Postgres é só cache local. Sync incremental por cron.

```
[cron 10min: trigger_ghl_v2_sync_all]  → por workspace GHL conectado
     ↓ chama (1 por workspace)
[ghl-conversations-sync]  → lista + "heat" por inbound + enrich de mídia (inline)
     ↓ grava ghl_conversations / ghl_messages, seta analyze_after em inbound novo
[cron 2min: trigger_ghl_v2_analyze_due]  → reivindica conversas com debounce vencido
     ↓ chama (1 por conversa, LIMIT 50/tick)
[ai-analyze-v2]  → grava em suggestions (ghl_conversation_id)
```

Regra-chave do 2.0: **inbound novo (lead) aciona análise; outbound (vendedor) não
re-analisa.** O debounce (~5min, teto 15min) está em colunas de `ghl_conversations`
(`analyze_after`, `analyze_started_at`, `last_analyzed_at`, `messages_synced_until`).

## 5. Mapa das Edge Functions

Localização: `supabase/functions/`. Todas usam
`_shared/error-reporter.ts`.

### Núcleo de IA
| Function | Papel | Disparo |
|---|---|---|
| `ai-analyze` | Análise 1.0 (lê `conversations`/`messages`) | `analyze-scheduler` / webhook |
| `ai-analyze-v2` | Análise 2.0 (lê `ghl_messages`) — clone do 1.0 com camada de dados trocada | cron analyze-due / manual |
| `analyze-scheduler` | Drena conversas 1.0 com `analyze_after` vencido | cron `* * * * *` |

### Cérebro analítico (analista do conjunto — distinto da análise por-conversa acima)
| Function | Papel | Disparo |
|---|---|---|
| `ai-insights-generate` | **IA.** Analisa AO VIVO por período (semana atual vs. anterior, lê `ghl_opportunities` — **sem snapshot**), 1 rodada por funil marcado + 1 combinada, respeitando a config do Analista. Grava insights em `ai_insights`. Métricas em `_shared/dashboard-metrics.ts` (`computePeriodMetrics`) | cron semanal `ai-insights-tick` |

Provider/custo de IA agora vivem em `_shared/ai-provider.ts`
e `_shared/ai-usage.ts` (extraídos de `ai-analyze-v2`
para as novas functions reusarem sem clonar).

### GHL
| Function | Papel | Disparo |
|---|---|---|
| `ghl-sync` | Snapshot de pipelines/users/custom fields/lost reasons/opportunities | cron / UI |
| `ghl-conversations-sync` | Sync incremental da lista de conversas (+ heat + enrich inline) | cron 10min / UI |
| `ghl-messages-sync` | Sync de mensagens de **uma** conversa (lazy, ao abrir) | UI / pré-análise |
| `ghl-enrich-attachments` | Enriquece mídia (transcrição/OCR) p/ a IA — wrapper de `_shared/ghl-enrich` | UI / pré-análise |
| `ghl-dashboard` | Agrega oportunidades → `DashboardData` (funil, filtros) | UI |
| `ghl-manage` | **Executa ações no GHL** (mover funil, nota, campo, valor, ganho/perdido) | UI (ao aprovar sugestão) |

### Canais de WhatsApp
| Function | Papel | Estado |
|---|---|---|
| `evolution-manage` | Gerencia instâncias Evolution | ativo |
| `evolution-pairing-public` | Página pública `/conectar/:token` (QR sem expor credencial) | ativo |
| `evolution-webhook` | Recebe mensagens Evolution | ativo |
| `stevo-webhook` / `stevo-oficial-webhook` | Recebe mensagens Stevo | ativo |
| `uazap-manage` / `uazap-webhook` | Canal Uazap | **desativado** (`UAZAP_ENABLED`) |

### Admin & utilitárias
| Function | Papel |
|---|---|
| `admin-bootstrap` | Primeiro usuário vira admin |
| `admin-users` | Gestão de usuários |
| `log-event` | Front grava em `system_logs` (observabilidade) |
| `pdf-extract` | Extrai texto de PDF (mídia → IA) — removida deste repo em 2026-08-08 (órfã aqui, sem chamador real; a instância que o GHL usa de verdade roda no projeto antigo) |

### Código compartilhado — `_shared/`
`error-reporter.ts` · `ghl-enrich.ts` · `ghl-sync.ts` · `media-extractor.ts` · `webhook-hmac.ts`

## 6. Crons (a camada que o diagrama esconde)

Definidos via `pg_cron` nas migrations. Todos usam o padrão Postgres → edge.

| Job | Frequência | O que faz |
|---|---|---|
| `ghl-v2-sync-tick` | `*/10 * * * *` | `trigger_ghl_v2_sync_all` → `ghl-conversations-sync` por workspace |
| `ghl-v2-analyze-tick` | `*/2 * * * *` | `trigger_ghl_v2_analyze_due` → `ai-analyze-v2` por conversa vencida |
| `analyze-scheduler-tick` | `* * * * *` | `analyze-scheduler` (rede de segurança do debounce 1.0) |
| `ai-insights-tick` | `30 6 * * 1` (seg 03h30 BRT) | `trigger_ai_insights_all` → `ai-insights-generate` por workspace (semanal); gate de Analista ligado é por config |

## 7. Tabelas centrais

| Tabela | Papel |
|---|---|
| `workspaces` / `integrations` | Unidade multi-tenant; integrações conectadas por workspace |
| `conversations` / `messages` | Conversas 1.0 (WhatsApp direto) |
| `ghl_conversations` / `ghl_messages` | Cache local do GHL 2.0 (estado do pipeline) |
| `user_ghl_links` | Liga usuário vflow360 ↔ usuário GHL (visibilidade) |
| `ghl_sync_watermarks` | Estado do sync incremental por workspace |
| `suggestions` | **Saída da IA** — ações sugeridas (pending/approved/rejected) |
| `ai_config` / `ai_provider_config` | O que a IA pode sugerir + provider/chave por workspace |
| `ai_insights` | Insights proativos gerados pelo Analista (card do Dashboard); `refs` traz o funil; gestor pode dispensar |
| `ghl_dashboard_settings.ai_insights_config` | Config do Analista por workspace: `{ enabled, combined:{prompt}, pipelines:[{id,prompt}] }` |
| `ghl_opportunities` / pipelines / custom_fields / lost_reasons | Snapshot do CRM p/ dashboard e execução |
| `system_logs` | Observabilidade (front + edge) |

## 8. O diagrama "IA-First", mapeado na realidade

A "Estrutura de Agentes" não é um runtime de agentes conversando em loop — é uma
lente conceitual. Mapeada no que existe:

| Agente no diagrama | Onde vive aqui de verdade |
|---|---|
| **Humano** | Gestor no front (páginas `Suggestions`, `Conversations2`, `Dashboard`). Aprova/edita/rejeita. |
| **Cérebro** | `ai-analyze` / `ai-analyze-v2` (decisão por LLM) + os crons/schedulers (orquestração determinística). |
| **Ferramentas** | `ghl-manage` (escrita no GHL) + as functions de sync/enrich (leitura). **Não há "tool agent" autônomo** — execução só após aprovação. |
| **Aprendizado** | **Ainda não existe como runtime** (e por decisão, não vai existir como agente auto-mutante). Fundação = `system_logs` + histórico de aprovação em `suggestions`. Aprendizado de verdade será offline e revisado por humano. Ver `OBSERVABILITY.md` (a escrever). |

Detalhe de cada capacidade: ver [`CAPABILITIES.md`](./CAPABILITIES.md).
