-- ============================================================================
-- Fix de consistência de RLS/GRANT em kommo.report_snapshots.
-- Contexto: a migration 20260709120000 concedeu insert/update/delete a
-- `authenticated` SEM policy correspondente (grant "morto" — o RLS bloqueava,
-- mas o privilégio ficava mais largo que o necessário) e não criava a policy
-- `svc all` presente em todas as demais tabelas kommo (a escrita funcionava
-- só pelo BYPASSRLS do service_role).
-- Este fix alinha a tabela ao padrão: authenticated só lê; service_role faz tudo
-- via policy explícita. Additive/corretivo: schema kommo apenas; não toca public/GHL.
-- ============================================================================

-- 1) Policy explícita de escrita para o service_role (padrão das demais tabelas).
drop policy if exists "svc all" on kommo.report_snapshots;
create policy "svc all" on kommo.report_snapshots
  for all to service_role using (true) with check (true);

-- 2) Enxugar privilégios: authenticated só precisa de SELECT (leitura via RLS).
revoke insert, update, delete on kommo.report_snapshots from authenticated;
