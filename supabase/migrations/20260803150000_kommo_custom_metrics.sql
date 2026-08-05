-- Métricas Personalizadas do Dashboard: até 3 métricas por workspace, cada uma
-- comparando contagens de leads por etapa (par pipeline+status) do Kommo.
-- Ex.: "Taxa de No Show" = passaram por "Agendamento" ÷ estão em "Não compareceu".
-- Aditiva; sem mudança de RLS (policies de kommo.dashboard_settings já são por
-- workspace_id, não por coluna).
ALTER TABLE kommo.dashboard_settings
  ADD COLUMN custom_metrics jsonb NOT NULL DEFAULT '[]'::jsonb;
