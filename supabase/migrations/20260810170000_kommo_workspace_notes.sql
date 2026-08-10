-- Anotações: bloco de notas mensal por workspace, sem relação com dashboard/
-- relatório/GHL — só um espaço livre para o usuário registrar o que foi
-- combinado/observado na reunião mensal. content guarda o doc JSON do Tiptap.
-- Aditiva; nova tabela, RLS por workspace_id no mesmo padrão de
-- kommo.dashboard_settings (membros leem/escrevem, service_role tudo).

create table kommo.workspace_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references kommo.workspaces(id) on delete cascade,
  title text not null default '',
  content jsonb not null default '{}'::jsonb,
  reference_month date not null,
  created_by uuid references kommo.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_kommo_workspace_notes_ws on kommo.workspace_notes (workspace_id, reference_month desc);

create trigger trg_kommo_workspace_notes_upd before update on kommo.workspace_notes
  for each row execute function kommo.set_updated_at();

alter table kommo.workspace_notes enable row level security;

create policy "members select" on kommo.workspace_notes for select
  using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "members insert" on kommo.workspace_notes for insert
  with check (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "members update" on kommo.workspace_notes for update
  using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "members delete" on kommo.workspace_notes for delete
  using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "svc all" on kommo.workspace_notes for all to service_role using (true) with check (true);

grant select, insert, update, delete on kommo.workspace_notes to authenticated;
grant select, insert, update, delete on kommo.workspace_notes to service_role;
