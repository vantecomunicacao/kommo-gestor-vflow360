-- ============================================================================
-- Duas peças de segurança/operação pra Análise de IA, pedidas depois da
-- migração da chave pro Vault (20260813140000):
--
-- 1) Rate limit por workspace (kommo.ai_call_log) — nada impedia hoje um
--    workspace disparar dezenas de chamadas de IA seguidas (custo na conta
--    OpenAI do próprio workspace, sem teto). Tabela de metering enxuta,
--    AUTO-LIMPA por workspace a cada checagem (sem cron novo) — só guarda a
--    última hora de chamadas, suficiente pra decidir liberar/bloquear.
--
-- 2) Auditoria de troca de chave (kommo.ai_provider_config_audit) — hoje não
--    dava pra saber quem criou/trocou/removeu a chave do workspace nem
--    quando. Gravada DENTRO das funções SECURITY DEFINER que já mexem na
--    chave (kommo.set_ai_provider_config / kommo.delete_ai_provider_config),
--    que ganham um parâmetro p_user_id (a edge já sabe o usuário via JWT).
--    Assinatura muda → funções recriadas (zero uso real em prod até agora,
--    a migração anterior é de hoje mesmo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Rate limit
-- ----------------------------------------------------------------------------
create table kommo.ai_call_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references kommo.workspaces(id) on delete cascade,
  mode         text not null,
  created_at   timestamptz not null default now()
);

create index idx_kommo_ai_call_log_ws_time on kommo.ai_call_log (workspace_id, created_at);

alter table kommo.ai_call_log enable row level security;

-- Só a edge (service_role) mexe aqui; não é dado que o frontend precisa ler.
create policy "svc all" on kommo.ai_call_log for all to service_role using (true) with check (true);

grant select, insert, delete on kommo.ai_call_log to service_role;

-- ----------------------------------------------------------------------------
-- 2) Auditoria da chave
-- ----------------------------------------------------------------------------
create table kommo.ai_provider_config_audit (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references kommo.workspaces(id) on delete cascade,
  user_id      uuid,
  action       text not null check (action in ('created', 'updated', 'deleted')),
  model        text,
  created_at   timestamptz not null default now()
);

create index idx_kommo_ai_provider_config_audit_ws on kommo.ai_provider_config_audit (workspace_id, created_at desc);

alter table kommo.ai_provider_config_audit enable row level security;

-- Membros veem o histórico (transparência: quem mexeu na chave do workspace).
-- Escrita só pelas funções SECURITY DEFINER abaixo (rodam como postgres, bypassa RLS).
create policy "members select" on kommo.ai_provider_config_audit
  for select using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "svc all" on kommo.ai_provider_config_audit for all to service_role using (true) with check (true);

grant select on kommo.ai_provider_config_audit to authenticated;
grant select, insert on kommo.ai_provider_config_audit to service_role;

-- ----------------------------------------------------------------------------
-- Funções recriadas com p_user_id (pra gravar quem fez a ação no audit)
-- ----------------------------------------------------------------------------
drop function if exists kommo.set_ai_provider_config(uuid, text, text);
drop function if exists kommo.delete_ai_provider_config(uuid);

create or replace function kommo.set_ai_provider_config(p_workspace_id uuid, p_api_key text, p_model text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = kommo, vault, public
as $$
declare
  v_secret_id uuid;
  v_name text := 'kommo_ai_key_' || p_workspace_id::text;
  v_existed boolean;
begin
  select api_key_secret_id into v_secret_id from kommo.ai_provider_config where workspace_id = p_workspace_id;
  v_existed := v_secret_id is not null;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_api_key, v_name, 'OpenAI key — kommo workspace');
  else
    perform vault.update_secret(v_secret_id, p_api_key, v_name, 'OpenAI key — kommo workspace');
  end if;

  insert into kommo.ai_provider_config (workspace_id, provider, model, api_key_secret_id)
  values (p_workspace_id, 'openai', p_model, v_secret_id)
  on conflict (workspace_id) do update
    set provider = 'openai', model = excluded.model, api_key_secret_id = excluded.api_key_secret_id;

  insert into kommo.ai_provider_config_audit (workspace_id, user_id, action, model)
  values (p_workspace_id, p_user_id, case when v_existed then 'updated' else 'created' end, p_model);
end;
$$;

create or replace function kommo.delete_ai_provider_config(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = kommo, vault, public
as $$
declare
  v_secret_id uuid;
  v_model text;
begin
  select api_key_secret_id, model into v_secret_id, v_model from kommo.ai_provider_config where workspace_id = p_workspace_id;
  delete from kommo.ai_provider_config where workspace_id = p_workspace_id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
    insert into kommo.ai_provider_config_audit (workspace_id, user_id, action, model)
    values (p_workspace_id, p_user_id, 'deleted', v_model);
  end if;
end;
$$;

revoke all on function kommo.set_ai_provider_config(uuid, text, text, uuid) from public;
revoke all on function kommo.delete_ai_provider_config(uuid, uuid) from public;
grant execute on function kommo.set_ai_provider_config(uuid, text, text, uuid) to service_role;
grant execute on function kommo.delete_ai_provider_config(uuid, uuid) to service_role;
