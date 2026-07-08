-- ============================================================================
-- Item 2 — Tarefas & Follow-up (higiene de vendas).
--   - kommo.leads.closest_task_at: data da próxima tarefa do lead (vazio = sem ação).
--   - kommo.tasks: tarefas do CRM (para "tarefas atrasadas" por vendedor).
-- Additive: só schema kommo; não toca em public/GHL.
-- ============================================================================

alter table kommo.leads add column if not exists closest_task_at timestamptz;

create table if not exists kommo.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references kommo.workspaces(id) on delete cascade,
  kommo_id text not null,             -- id da tarefa no Kommo
  lead_id text,                       -- entity_id (quando entity_type = leads)
  responsible_user_id text,
  complete_till timestamptz,          -- prazo
  is_completed boolean not null default false,
  task_type_id text,
  text text,
  kommo_created_at timestamptz,
  kommo_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, kommo_id)
);

create index if not exists idx_kommo_tasks_open
  on kommo.tasks (workspace_id, is_completed, complete_till);
create index if not exists idx_kommo_tasks_lead
  on kommo.tasks (workspace_id, lead_id);
create index if not exists idx_kommo_leads_closest_task
  on kommo.leads (workspace_id, closest_task_at);

alter table kommo.tasks enable row level security;
create policy "members select" on kommo.tasks
  for select using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "svc all" on kommo.tasks
  for all to service_role using (true) with check (true);

-- GRANTs (o GRANT ON ALL TABLES da fundação não cobre tabelas criadas depois).
grant select, insert, update, delete on kommo.tasks to service_role;
grant select on kommo.tasks to authenticated;
