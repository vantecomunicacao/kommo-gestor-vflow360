-- ============================================================================
-- M4d — Cron de sync automático do Kommo.
-- Padrão postgres -> edge (net.http_post com anon key), NUNCA edge->edge.
-- A cada 15 min: para cada integração Kommo conectada, chama kommo-sync com
-- apenas workspace_id (o token vem do Vault dentro da função).
-- anon key + URL do projeto xcrfbpyhyznyufijrdry (mesmo padrão das migrations GHL).
-- Additive: schema kommo + cron job próprio; não toca em public/GHL.
-- ============================================================================

create or replace function kommo.trigger_sync_all()
returns void
language plpgsql
security definer
set search_path = kommo, public
as $$
declare
  ws record;
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjcmZicHloeXpueXVmaWpyZHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTc0NDAsImV4cCI6MjA5NDg5MzQ0MH0._6Oe1CSLsxUgI6PlffPAoqYJYPKSMEApDyNergx0yYg';
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
        'apikey', anon_key
      ),
      body := jsonb_build_object('workspace_id', ws.workspace_id, 'cron', true),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$$;

-- só a role do cron (postgres) precisa executar; tranca para o resto
revoke all on function kommo.trigger_sync_all() from public;

-- agenda (recria se já existir)
select cron.unschedule('kommo-sync-tick')
  where exists (select 1 from cron.job where jobname = 'kommo-sync-tick');
select cron.schedule(
  'kommo-sync-tick',
  '*/15 * * * *',
  $tick$ select kommo.trigger_sync_all(); $tick$
);
