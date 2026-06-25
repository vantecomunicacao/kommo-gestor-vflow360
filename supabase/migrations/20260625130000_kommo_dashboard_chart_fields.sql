-- ============================================================================
-- Restaura a feature nativa de "gráfico de pizza por campo personalizado".
-- A coluna existia no schema antigo (public, migration 20260423000243) mas não
-- veio para a fundação do schema `kommo`. `chart_custom_fields` guarda os kommo_id
-- dos campos de lead que o usuário marcou para exibir como pizza no dashboard.
-- Additive: só adiciona coluna no schema kommo; não toca em public/GHL.
-- ============================================================================

alter table kommo.dashboard_settings
  add column if not exists chart_custom_fields text[] not null default '{}'::text[];
