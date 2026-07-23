-- ============================================================================
-- Favoritar/fixar análises da IA do Dashboard.
-- Adiciona kommo.dashboard_analyses.pinned: o gestor fixa análises importantes no
-- topo do histórico. Toggle feito pela edge kommo-ai-analyze (modo "pin") via service
-- role; exclusão pelo modo "delete". Additive (default false); sem mudança de RLS.
-- ============================================================================

alter table kommo.dashboard_analyses
  add column if not exists pinned boolean not null default false;
