-- ============================================================================
-- Hardening de auth das edge functions Kommo — segredo interno nos crons.
--
-- Contexto: as edges kommo-dashboard / kommo-sync / kommo-report-snapshot
-- passaram a EXIGIR JWT válido + membership (usuário) OU um segredo interno
-- (chamadas postgres->edge dos crons). Ver supabase/functions/_shared/authorize.ts.
-- O padrão antigo "sem usuário no JWT = liberado" foi removido (era a brecha).
--
-- Esta migration recria as 3 funções de cron para enviarem o header
-- `x-internal-secret`, cujo valor vem do Vault (secret `kommo_internal_function_secret`).
-- O MESMO valor precisa estar no env `INTERNAL_FUNCTION_SECRET` das 3 edges.
--
-- PRÉ-REQUISITO (rodar UMA vez, antes de aplicar — com um valor forte, ex. `openssl rand -hex 32`):
--   select vault.create_secret('<VALOR_SECRETO>', 'kommo_internal_function_secret',
--                              'Segredo interno cron->edge (auth das funções Kommo)');
--
-- Additive: schema kommo + vault; não toca em public/GHL.
-- ============================================================================

-- Leitor do segredo interno (SECURITY DEFINER: só o dono acessa o Vault).
create or replace function kommo.internal_function_secret()
returns text
language sql
security definer
set search_path = kommo, vault, public
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name = 'kommo_internal_function_secret'
  limit 1;
$$;

revoke all on function kommo.internal_function_secret() from public;

-- ---------------------------------------------------------------------------
-- 1) tick incremental → kommo-sync
-- ---------------------------------------------------------------------------
create or replace function kommo.trigger_sync_all()
returns void
language plpgsql
security definer
set search_path = kommo, public
as $$
declare
  ws record;
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjcmZicHloeXpueXVmaWpyZHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTc0NDAsImV4cCI6MjA5NDg5MzQ0MH0._6Oe1CSLsxUgI6PlffPAoqYJYPKSMEApDyNergx0yYg';
  secret text := kommo.internal_function_secret();
begin
  for ws in
    select distinct workspace_id
    from kommo.integrations
    where type = 'kommo' and status = 'connected' and workspace_id is not null
  loop
    perform net.http_post(
      url := 'https://xcrfbpyhyznyufijrdry.supabase.co/functions/v1/kommo-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key,
        'x-internal-secret', secret
      ),
      body := jsonb_build_object('workspace_id', ws.workspace_id, 'cron', true),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$$;

revoke all on function kommo.trigger_sync_all() from public;

-- ---------------------------------------------------------------------------
-- 2) full-scan diário → kommo-sync { full: true }
-- ---------------------------------------------------------------------------
create or replace function kommo.trigger_sync_all_full()
returns void
language plpgsql
security definer
set search_path = kommo, public
as $$
declare
  ws record;
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjcmZicHloeXpueXVmaWpyZHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTc0NDAsImV4cCI6MjA5NDg5MzQ0MH0._6Oe1CSLsxUgI6PlffPAoqYJYPKSMEApDyNergx0yYg';
  secret text := kommo.internal_function_secret();
begin
  for ws in
    select distinct workspace_id
    from kommo.integrations
    where type = 'kommo' and status = 'connected' and workspace_id is not null
  loop
    perform net.http_post(
      url := 'https://xcrfbpyhyznyufijrdry.supabase.co/functions/v1/kommo-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key,
        'x-internal-secret', secret
      ),
      body := jsonb_build_object('workspace_id', ws.workspace_id, 'cron', true, 'full', true),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$$;

revoke all on function kommo.trigger_sync_all_full() from public;

-- ---------------------------------------------------------------------------
-- 3) fotos mensais → kommo-report-snapshot
-- ---------------------------------------------------------------------------
create or replace function kommo.trigger_report_snapshot_all()
returns void
language plpgsql
security definer
set search_path = kommo, public
as $$
declare
  ws record;
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjcmZicHloeXpueXVmaWpyZHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTc0NDAsImV4cCI6MjA5NDg5MzQ0MH0._6Oe1CSLsxUgI6PlffPAoqYJYPKSMEApDyNergx0yYg';
  secret text := kommo.internal_function_secret();
begin
  for ws in
    select distinct workspace_id
    from kommo.integrations
    where type = 'kommo' and status = 'connected' and workspace_id is not null
  loop
    perform net.http_post(
      url := 'https://xcrfbpyhyznyufijrdry.supabase.co/functions/v1/kommo-report-snapshot',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key,
        'x-internal-secret', secret
      ),
      body := jsonb_build_object('workspace_id', ws.workspace_id, 'months', 12, 'cron', true),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$$;

revoke all on function kommo.trigger_report_snapshot_all() from public;
