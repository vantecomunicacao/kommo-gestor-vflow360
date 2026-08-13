-- ============================================================================
-- Chave de IA (OpenAI) passa a ser cifrada no Supabase Vault — mesmo padrão já
-- usado pro token do Kommo (20260618120000_kommo_vault_token.sql).
--
-- Motivo: kommo.ai_provider_config.api_key era uma coluna `text` comum. Um
-- vazamento da service_role key (env, backup, dump) ou um bug de RLS numa
-- migration futura expunha a chave OpenAI de TODOS os workspaces em texto
-- puro. Agora a chave em si vive no Vault (cifrada); a tabela só guarda a
-- REFERÊNCIA (api_key_secret_id). Descriptografar só é possível via as
-- funções abaixo, restritas a service_role.
--
-- Efeito colateral necessário: como o valor real deixa de estar numa coluna
-- comum, membros do workspace NÃO PODEM MAIS gravar/ler a chave direto pela
-- tabela (supabase-js do frontend) — toda escrita/leitura da chave passa a
-- ir pela edge kommo-ai-analyze (modos provider_status/provider_save/
-- provider_delete, todos via service_role). RLS de authenticated fica só
-- leitura de metadados não sensíveis (nenhum — a UI usa a edge pra tudo);
-- removidas as policies de insert/update/delete de "members" que a migration
-- anterior criou.
--
-- 0 linhas em kommo.ai_provider_config no momento desta migration (nenhum
-- workspace tinha configurado chave ainda) — não há dado em texto puro pra
-- migrar pro Vault.
-- ============================================================================

alter table kommo.ai_provider_config add column api_key_secret_id uuid;

-- Cria/atualiza a chave do workspace (secret no Vault + linha da tabela).
create or replace function kommo.set_ai_provider_config(p_workspace_id uuid, p_api_key text, p_model text)
returns void
language plpgsql
security definer
set search_path = kommo, vault, public
as $$
declare
  v_secret_id uuid;
  v_name text := 'kommo_ai_key_' || p_workspace_id::text;
begin
  select api_key_secret_id into v_secret_id from kommo.ai_provider_config where workspace_id = p_workspace_id;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_api_key, v_name, 'OpenAI key — kommo workspace');
  else
    perform vault.update_secret(v_secret_id, p_api_key, v_name, 'OpenAI key — kommo workspace');
  end if;

  insert into kommo.ai_provider_config (workspace_id, provider, model, api_key_secret_id)
  values (p_workspace_id, 'openai', p_model, v_secret_id)
  on conflict (workspace_id) do update
    set provider = 'openai', model = excluded.model, api_key_secret_id = excluded.api_key_secret_id;
end;
$$;

-- Lê a chave decifrada + modelo do workspace (só service_role — usada pela edge pra chamar a OpenAI).
create or replace function kommo.get_ai_provider_config(p_workspace_id uuid)
returns table (api_key text, model text)
language plpgsql
security definer
set search_path = kommo, vault, public
as $$
begin
  return query
  select ds.decrypted_secret, c.model
  from kommo.ai_provider_config c
  join vault.decrypted_secrets ds on ds.id = c.api_key_secret_id
  where c.workspace_id = p_workspace_id;
end;
$$;

-- Remove a chave do workspace (secret do Vault + linha da tabela).
create or replace function kommo.delete_ai_provider_config(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = kommo, vault, public
as $$
declare v_secret_id uuid;
begin
  select api_key_secret_id into v_secret_id from kommo.ai_provider_config where workspace_id = p_workspace_id;
  delete from kommo.ai_provider_config where workspace_id = p_workspace_id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

revoke all on function kommo.set_ai_provider_config(uuid, text, text) from public;
revoke all on function kommo.get_ai_provider_config(uuid) from public;
revoke all on function kommo.delete_ai_provider_config(uuid) from public;
grant execute on function kommo.set_ai_provider_config(uuid, text, text) to service_role;
grant execute on function kommo.get_ai_provider_config(uuid) to service_role;
grant execute on function kommo.delete_ai_provider_config(uuid) to service_role;

-- A chave deixa de existir como coluna comum.
alter table kommo.ai_provider_config drop column api_key;

-- Escrita/leitura de metadados passam a ir só pela edge (service_role); tira o
-- acesso direto de "members" que a migration anterior deu pra insert/update/delete.
drop policy if exists "members insert" on kommo.ai_provider_config;
drop policy if exists "members update" on kommo.ai_provider_config;
drop policy if exists "members delete" on kommo.ai_provider_config;
drop policy if exists "members select" on kommo.ai_provider_config;
