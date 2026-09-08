-- ============================================================================
-- Fase 3.1 do plano de remediação — Cache da resposta do kommo-dashboard.
--
-- Contexto: hoje cada acesso ao Dashboard faz o kommo-dashboard buscar TODOS os
-- leads + TODOS os eventos de etapa + TODAS as tarefas do workspace e agregar em
-- memória na edge function. Sem impacto na escala atual (~20-30 contas), mas é o
-- teto de crescimento. Esta tabela guarda a resposta já calculada, chaveada por
-- workspace + combinação de filtros, e a edge function a reaproveita enquanto o
-- sync e as configurações do Dashboard não mudarem (invalidação por "assinatura").
--
-- Aditiva: tabela nova no schema kommo, RLS própria. Não toca em tabela
-- existente, não toca em public/GHL. A edge function só usa esta tabela quando
-- o secret DASHBOARD_CACHE está ligado (default: desligada — muda nada).
-- ============================================================================

create table if not exists kommo.dashboard_cache (
  workspace_id  uuid        not null references kommo.workspaces(id) on delete cascade,
  -- sha256 hex da combinação de filtros normalizada (ver filtersHash em
  -- kommo-dashboard/index.ts). Não inclui workspace_id (é a chave de partição).
  filters_hash  text        not null,
  payload       jsonb       not null,
  -- Assinaturas de invalidação: se qualquer uma diferir do estado atual, o
  -- cache é ignorado e recalculado.
  --   sync_sig     = kommo.sync_status.last_sync_at  (bumpa a cada sync concluído)
  --   settings_sig = kommo.dashboard_settings.updated_at (bumpa quando o usuário
  --                  edita Configurações do Dashboard)
  sync_sig      text        not null default '',
  settings_sig  text        not null default '',
  computed_at   timestamptz not null default now(),
  primary key (workspace_id, filters_hash)
);

comment on table kommo.dashboard_cache is
  'Fase 3.1: cache da resposta do kommo-dashboard por workspace+filtros. '
  'Invalidado por assinatura (sync_status.last_sync_at / dashboard_settings.updated_at) '
  'e por TTL de segurança na edge function. Descartável — pode ser truncado a qualquer momento.';

create index if not exists idx_kommo_dashboard_cache_computed_at
  on kommo.dashboard_cache (computed_at);

alter table kommo.dashboard_cache enable row level security;

-- Só a service_role (edge function) lê/escreve. Ninguém acessa direto pelo front.
create policy "svc all" on kommo.dashboard_cache
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Limpeza diária: linhas velhas (combinações de filtro raras, ex.: períodos
-- personalizados que ninguém reabre) só ocupam espaço. 48h cobre "ontem" com
-- folga; o que ainda for consultado é regravado na primeira chamada.
-- ---------------------------------------------------------------------------
create or replace function kommo.cleanup_dashboard_cache()
returns void
language sql
security definer
set search_path = kommo, public
as $$
  delete from kommo.dashboard_cache where computed_at < now() - interval '48 hours';
$$;

revoke all on function kommo.cleanup_dashboard_cache() from public;

select cron.unschedule('kommo-dashboard-cache-cleanup')
  where exists (select 1 from cron.job where jobname = 'kommo-dashboard-cache-cleanup');
select cron.schedule(
  'kommo-dashboard-cache-cleanup',
  '20 4 * * *',
  $cleanup$ select kommo.cleanup_dashboard_cache(); $cleanup$
);
