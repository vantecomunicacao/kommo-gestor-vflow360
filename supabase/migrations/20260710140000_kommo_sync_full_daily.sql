-- ============================================================================
-- Reconciliação diária de exclusões do Kommo (full-scan 1x/dia).
--
-- Problema: o `kommo-sync-tick` (a cada 15 min) é INCREMENTAL — puxa só o que
-- mudou via watermark. Um lead apagado no Kommo apenas some de /leads e nunca
-- volta marcado, então o incremental jamais o reconcilia: o espelho acumula
-- "zumbis" (is_deleted = false) e infla as contagens do dashboard/relatórios.
--
-- Correção: 1x/dia chamar kommo-sync com { full: true } → força full-scan, e o
-- kommo-sync (bloco "6b. Reconciliação de exclusões") marca is_deleted em tudo
-- que existe local mas não veio na varredura completa.
--
-- Padrão postgres -> edge (net.http_post com anon key), NUNCA edge->edge.
-- Additive: schema kommo + cron job próprio; não toca em public/GHL.
-- ============================================================================

create or replace function kommo.trigger_sync_all_full()
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
      body := jsonb_build_object('workspace_id', ws.workspace_id, 'cron', true, 'full', true),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$$;

-- só a role do cron (postgres) precisa executar; tranca para o resto
revoke all on function kommo.trigger_sync_all_full() from public;

-- agenda diária (recria se já existir). 06:20 UTC ≈ 03:20 BRT (fora do horário de pico).
select cron.unschedule('kommo-sync-full-daily')
  where exists (select 1 from cron.job where jobname = 'kommo-sync-full-daily');
select cron.schedule(
  'kommo-sync-full-daily',
  '20 6 * * *',
  $tick$ select kommo.trigger_sync_all_full(); $tick$
);
