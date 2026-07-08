# Log de Decisões

> Histórico **datado** de decisões e mudanças relevantes do sistema. Diferente dos
> outros docs (que descrevem o *estado atual*), aqui é o *rastro ao longo do tempo*:
> o que mudou, quando, por quê e o impacto.
>
> **Disciplina:** toda mudança relevante (arquitetura, regra de IA, remoção/criação
> de capacidade, decisão de produto) vira uma entrada aqui, mais recente no topo.
> Mudanças triviais (refactor, fix pontual) não precisam entrar.

Formato de cada entrada: `## AAAA-MM-DD — Título` · **O quê** · **Por quê** · **Impacto**.

---

## 2026-07-07 — Fase 1 = analytics Kommo; copiloto de IA vira Fase 2
- **O quê:** definido que o produto Kommo entrega, na Fase 1, um **painel de gestão/
  analytics** coerente e completo. O **copiloto de IA** (Sugestões, Conversas, Analista)
  e a observabilidade (Logs/Sistema) saem do produto e viram **Fase 2**. Removidas do
  menu/rotas essas páginas; `cooling-leads` reescrita para ler `kommo.leads` (sem GHL);
  `kommo-sync` ganhou **sync incremental** por `sync_watermarks`
  (`20260707120000_kommo_sync_watermarks_incremental.sql`); docs marcadas como
  "estado atual Kommo" vs. "histórico GHL".
- **Por quê:** decisão de produto — o valor no Kommo é o painel de gestão, não o
  copiloto; e a IA por conversa depende de matéria-prima (mensagens) que o schema
  `kommo` **não tem** hoje. Fechar a migração com honestidade > deixar metade das rotas
  em "Em breve" e uma rota viva (`/cooling-leads`) apontando para tabelas GHL.
- **Impacto:** app Kommo sem pontas soltas nem dependência de `public.*`/`ghl_*`. A
  Fase 2 (copiloto) fica gated por validar a API de conversas do Kommo — ver
  `ROADMAP_FASE2_COPILOTO.md`. Sem pressa: prioridade é fazer certo.

## 2026-06-07 — C1: versionamento do prompt das sugestões (AI_DECISIONS #2)
- **O quê:** coluna `suggestions.prompt_version` + constante `PROMPT_VERSION` em `ai-analyze-v2`, gravada em cada sugestão.
- **Por quê:** sem saber qual versão de prompt gerou cada sugestão, não dá pra medir offline se uma mudança melhorou ou piorou a qualidade.
- **Impacto:** comportamento da IA inalterado; só passa a gravar a versão. Sugestões antigas ficam `null`. Convenção: bump no `PROMPT_VERSION` ao mudar prompt ou guardrail pós-LLM. Migration `20260607170000`.

## 2026-06-07 — Decisão #1 (auto_approve) resolvida: execução de verdade
- **O quê:** `auto_approve` mantido como pré-autorização explícita por tipo **e** agora executa, via cron postgres→edge `ghl-v2-auto-execute-tick` (3min) → `ghl-manage/execute_suggestion` (service-role do Vault, retry ≤3 via `action_data.auto_exec_tries`). A v2 marca `auto_execute_pending:true` no insert.
- **Por quê:** o objetivo "só o que for aprovado" foi refinado — auto-aprovação é uma autorização prévia consciente por tipo; faltava a execução real (antes era edge→edge, que falha aqui).
- **Impacto:** ações auto-aprovadas saem do limbo "approved mas não executado". Regra edge→edge continua valendo (por isso postgres→edge).

## 2026-06-07 — Cérebro analítico (analista do conjunto)
- **O quê:** `ai-snapshot` (determinístico, retrato semanal por funil em `analytics_snapshots`) + `ai-insights-generate` (IA, insights proativos em `ai_insights`, com `prompt_version`). Crons semanais. Helpers extraídos p/ `_shared/` (`ai-provider.ts`, `ai-usage.ts`, `dashboard-metrics.ts`).
- **Por quê:** dar ao gestor leitura proativa do funil (comparação semana a semana), distinta da sugestão por-conversa.
- **Impacto:** nova capacidade C2; análise **sempre por funil separado**, nunca misturada. Card "Insights com I.A." no Dashboard.

## 2026-06-07 — Evolution/Stevo 1.0 descomissionada
- **O quê:** removidas em prod 9 edge functions, o frontend de WhatsApp e as tabelas `conversations`/`messages` + sugestões 1.0. Só resta 2.0/GHL.
- **Por quê:** o GHL passou a ser fonte única; manter dois mundos em paralelo era custo de manutenção e risco de divergência.
- **Impacto:** sugestões agora só via `ghl_conversations`. Decisão #3 (unificar ai-analyze 1.0/2.0) tornou-se obsoleta por consequência.

## 2026-06-03 — Iniciativa de documentação IA-first
- **O quê:** criados 4 docs em `docs/` — `ARCHITECTURE`, `CAPABILITIES`, `AI_DECISIONS`, `OBSERVABILITY`.
- **Por quê:** o sistema estava documentado *espalhado* (comentários de migrations/functions); faltava a visão transversal e o registro das decisões de IA.
- **Impacto:** base para o trabalho de "IA-first" e para reduzir re-contextualização. Princípios fixados: IA só sugere (gestor aprova); aprendizado offline revisado por humano, sem agente auto-mutante.
