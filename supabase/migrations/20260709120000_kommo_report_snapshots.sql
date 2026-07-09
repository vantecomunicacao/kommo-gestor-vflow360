-- ============================================================================
-- Relatórios — fotos mensais congeladas para comparação mês a mês.
-- Tela /relatorios lê estas linhas; a edge function kommo-report-snapshot grava
-- (backfill dos meses reconstruíveis + fechamento no dia 1º via cron + botão manual).
-- Uma linha por workspace × funil × mês × eixo (criacao|fechamento).
-- `metrics` é jsonb para evoluir métricas sem nova migration.
-- Additive: schema kommo apenas; não toca em public/GHL.
-- ============================================================================

create table if not exists kommo.report_snapshots (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references kommo.workspaces(id) on delete cascade,
  pipeline_id  text not null default '__all__',           -- funil (ou '__all__')
  month        date not null,                             -- 1º dia do mês (BRT)
  date_basis   text not null check (date_basis in ('criacao','fechamento')),
  metrics      jsonb not null default '{}'::jsonb,         -- mapa métrica -> valor
  is_partial   boolean not null default false,            -- mês corrente ainda aberto
  frozen_at    timestamptz not null default now(),        -- quando a foto foi tirada
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, pipeline_id, month, date_basis)
);

create index if not exists report_snapshots_lookup_idx
  on kommo.report_snapshots (workspace_id, date_basis, pipeline_id, month);

alter table kommo.report_snapshots enable row level security;

-- Membros do workspace leem; a escrita é feita pela edge function via service role
-- (que ignora RLS), então não há policy de insert/update para usuários comuns.
create policy "members select" on kommo.report_snapshots
  for select using (kommo.is_workspace_member(auth.uid(), workspace_id));

-- Privilégios de tabela (RLS não dispensa GRANT). Mesmo padrão das demais tabelas kommo.
grant select, insert, update, delete on kommo.report_snapshots to authenticated, service_role;
