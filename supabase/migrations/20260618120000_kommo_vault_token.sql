-- ============================================================================
-- M4a — Token Kommo cifrado via Supabase Vault.
-- Wrappers SECURITY DEFINER no schema `kommo` (PostgREST não expõe o schema vault).
-- Só `service_role` (edge functions) pode executar — authenticated/anon REVOKED.
-- Additive: não toca em public/GHL.
-- ============================================================================

create extension if not exists supabase_vault with schema vault;

-- Cria (ou atualiza) o secret do token no Vault e amarra em kommo.integrations.token_secret_id
create or replace function kommo.set_integration_token(p_integration_id uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = kommo, vault, public
as $$
declare
  v_secret_id uuid;
  v_name text := 'kommo_token_' || p_integration_id::text;
begin
  select token_secret_id into v_secret_id from kommo.integrations where id = p_integration_id;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_token, v_name, 'Kommo long-lived token');
    update kommo.integrations set token_secret_id = v_secret_id where id = p_integration_id;
  else
    perform vault.update_secret(v_secret_id, p_token, v_name, 'Kommo long-lived token');
  end if;
  return v_secret_id;
end;
$$;

-- Lê o token decifrado de uma integração (só service_role)
create or replace function kommo.get_integration_token(p_integration_id uuid)
returns text
language plpgsql
security definer
set search_path = kommo, vault, public
as $$
declare v_token text;
begin
  select ds.decrypted_secret into v_token
  from kommo.integrations i
  join vault.decrypted_secrets ds on ds.id = i.token_secret_id
  where i.id = p_integration_id;
  return v_token;
end;
$$;

-- Trava de acesso: apenas service_role executa (default do Postgres concede a PUBLIC)
revoke all on function kommo.set_integration_token(uuid, text) from public;
revoke all on function kommo.get_integration_token(uuid) from public;
grant execute on function kommo.set_integration_token(uuid, text) to service_role;
grant execute on function kommo.get_integration_token(uuid) to service_role;
