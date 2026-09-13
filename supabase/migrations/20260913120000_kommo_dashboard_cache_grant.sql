-- ============================================================================
-- Fix da Fase 3.1: faltou o GRANT de tabela pro service_role em
-- kommo.dashboard_cache. A migration 20260908120000 criou a RLS policy ("svc
-- all"), mas RLS só filtra LINHAS — sem o GRANT de base, o Postgres nega o
-- acesso à tabela inteira antes de a policy sequer ser avaliada. Achado ao
-- rodar um backup manual (Fase 0.3): `select * from kommo.dashboard_cache`
-- via service_role voltou "permission denied for table dashboard_cache".
--
-- Efeito real do bug: como DASHBOARD_CACHE está desligado por padrão, isso
-- nunca quebrou nada em produção — mas se alguém tivesse ligado o secret, o
-- cache simplesmente nunca funcionaria (leitura e escrita falhando, engolidas
-- pelo try/catch em kommo-dashboard/index.ts, sempre caindo no cálculo normal
-- — sem erro visível, só sem o ganho de performance).
-- ============================================================================

grant select, insert, update, delete on kommo.dashboard_cache to service_role;
