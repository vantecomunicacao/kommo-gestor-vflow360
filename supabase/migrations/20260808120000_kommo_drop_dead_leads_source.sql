-- Remove kommo.leads.source: coluna nunca preenchida de verdade. O kommo-sync
-- sempre gravava `source: null` (funcionalidade de origem automática nunca foi
-- implementada) — a origem real do lead já vem de "Origem do lead" (custom
-- field configurável) + os 5 campos de UTM, ambos já lidos corretamente pelo
-- kommo-dashboard. Achado 2026-08-06, decisão de remover em 2026-08-08 (ver
-- CLAUDE.md).
alter table kommo.leads drop column if exists source;
