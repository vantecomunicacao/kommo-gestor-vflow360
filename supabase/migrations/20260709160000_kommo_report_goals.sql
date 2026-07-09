-- ============================================================================
-- Metas do Relatório (meta fixa mensal por métrica).
-- Guarda um mapa jsonb { "<eixo>:<metricId>": <alvo numérico> }, ex.:
--   { "fechamento:won": 30, "fechamento:wonRevenue": 50000 }
-- A chave leva o eixo (criacao/fechamento) porque a mesma métrica muda de sentido
-- entre as abas Comercial/Financeiro. Aplicada pelo frontend (Relatório) via upsert.
-- Additive: só coluna nova em kommo.dashboard_settings.
-- ============================================================================

alter table kommo.dashboard_settings
  add column if not exists report_goals jsonb not null default '{}'::jsonb;
