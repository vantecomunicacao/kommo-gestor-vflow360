-- ============================================================================
-- Permite renomear os rótulos das 4 fases do funil analítico por workspace.
-- `funnel_stage_labels` guarda um objeto bucket -> rótulo customizado, ex.:
--   { "contato_inicial": "Lead Novo", "venda_ganha": "Cliente Fechado" }
-- Buckets ausentes caem no rótulo padrão (definido em src/lib/dashboard-funnel.ts).
-- O override é aplicado no frontend, então não exige redeploy da edge function.
-- Additive: só adiciona coluna no schema kommo; não toca em public/GHL.
-- ============================================================================

alter table kommo.dashboard_settings
  add column if not exists funnel_stage_labels jsonb not null default '{}'::jsonb;
