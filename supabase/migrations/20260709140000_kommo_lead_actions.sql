-- ============================================================================
-- Ações do vflow sobre leads (anti-duplicidade dos "leads esfriando").
-- Registra cada tarefa/tag que o app criou no Kommo, para:
--   1) não criar 2x (idempotência no kommo-actions);
--   2) marcar no card quais leads já receberam tarefa/tag (taskDone/tagDone).
-- Uma linha por workspace × lead × kind. Escrita pela edge function kommo-actions
-- (service_role); leitura por membros via RLS.
-- Additive: schema kommo apenas; não toca em public/GHL.
-- ============================================================================

create table if not exists kommo.lead_actions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references kommo.workspaces(id) on delete cascade,
  lead_kommo_id text not null,                          -- id do lead no Kommo
  kind          text not null check (kind in ('task','tag')),
  created_by    uuid,                                   -- usuário que disparou
  created_at    timestamptz not null default now(),
  unique (workspace_id, lead_kommo_id, kind)
);

create index if not exists idx_kommo_lead_actions_lookup
  on kommo.lead_actions (workspace_id, lead_kommo_id);

alter table kommo.lead_actions enable row level security;
create policy "members select" on kommo.lead_actions
  for select using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "svc all" on kommo.lead_actions
  for all to service_role using (true) with check (true);

-- GRANTs (o GRANT ON ALL TABLES da fundação não cobre tabelas criadas depois).
grant select, insert, update, delete on kommo.lead_actions to service_role;
grant select on kommo.lead_actions to authenticated;
