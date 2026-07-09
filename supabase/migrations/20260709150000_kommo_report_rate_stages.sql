-- ============================================================================
-- Configuração das "taxas de etapa" do Relatório (ex.: Taxa de Agendamento).
-- Guarda os kommo_id das etapas que o usuário escolhe (Configurações do Dashboard);
-- a edge function kommo-report-snapshot calcula, por safra de criação, quantos leads
-- alcançaram cada etapa. Additive: só coluna nova em kommo.dashboard_settings.
-- ============================================================================

alter table kommo.dashboard_settings
  add column if not exists report_rate_stages text[] default '{}'::text[];
