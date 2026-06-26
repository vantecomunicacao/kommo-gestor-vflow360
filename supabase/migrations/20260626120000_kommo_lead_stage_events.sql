-- ============================================================================
-- Item 1 — Histórico de mudança de etapa dos leads (eventos do Kommo).
-- Alimenta "Tempo por etapa" e velocidade do funil. Origem: Kommo /events
-- (type=lead_status_changed). Additive: só schema kommo; não toca em public/GHL.
-- ============================================================================

create table if not exists kommo.lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references kommo.workspaces(id) on delete cascade,
  event_id text not null,            -- id do evento no Kommo (dedup)
  lead_id text not null,             -- kommo_id do lead
  pipeline_id text,
  before_status_id text,
  after_status_id text,
  changed_at timestamptz not null,   -- quando a mudança ocorreu
  created_at timestamptz not null default now(),
  unique (workspace_id, event_id)
);

create index if not exists idx_kommo_lse_lead
  on kommo.lead_stage_events (workspace_id, lead_id, changed_at);
create index if not exists idx_kommo_lse_ws_changed
  on kommo.lead_stage_events (workspace_id, changed_at);

alter table kommo.lead_stage_events enable row level security;

-- Mesmo padrão das demais tabelas kommo: membros leem; service_role faz tudo.
create policy "members select" on kommo.lead_stage_events
  for select using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "svc all" on kommo.lead_stage_events
  for all to service_role using (true) with check (true);

-- GRANTs: o `GRANT ON ALL TABLES` da fundação não cobre tabelas criadas depois.
grant select, insert, update, delete on kommo.lead_stage_events to service_role;
grant select on kommo.lead_stage_events to authenticated;
