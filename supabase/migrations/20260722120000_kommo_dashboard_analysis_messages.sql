-- ============================================================================
-- Conversa de acompanhamento (follow-ups) na Análise IA do Dashboard.
-- Adiciona kommo.dashboard_analyses.messages: cada análise vira uma mini-thread —
-- depois do relatório, o gestor pode perguntar mais, ancorado no MESMO snapshot
-- (metrics) já buscado (a edge kommo-ai-analyze, modo followup, NÃO re-consulta o CRM).
-- Cada item: { "role": "user"|"assistant", "content": text }.
-- Additive: coluna com default '[]'; linhas antigas ficam sem conversa. Não muda RLS.
-- ============================================================================

alter table kommo.dashboard_analyses
  add column if not exists messages jsonb not null default '[]'::jsonb;
