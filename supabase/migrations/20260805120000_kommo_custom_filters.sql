-- Filtros Personalizados do Dashboard: até 4 filtros por workspace, cada um mapeando
-- um campo personalizado de lead (ex.: "Transferido") para um dropdown de filtro extra
-- na barra do Dashboard, com label configurável ({id, label, fieldId}).
-- Aditiva; sem mudança de RLS (policies de kommo.dashboard_settings já são por
-- workspace_id, não por coluna).
ALTER TABLE kommo.dashboard_settings
  ADD COLUMN custom_filters jsonb NOT NULL DEFAULT '[]'::jsonb;
