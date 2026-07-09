-- ============================================================================
-- Cron das fotos mensais (Relatórios).
-- Padrão postgres -> edge (net.http_post com anon key), NUNCA edge->edge.
-- Diário 03:10 UTC (~00:10 BRT): para cada integração Kommo conectada, chama
-- kommo-report-snapshot, que recomputa os últimos 12 meses + o corrente. O mês
-- corrente fica is_partial=true; a virada do dia 1º congela o mês anterior
-- automaticamente (sem lógica de calendário no cron).
-- Additive: schema kommo + cron job próprio; não toca em public/GHL.
-- ============================================================================

create or replace function kommo.trigger_report_snapshot_all()
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
      url := 'https://xcrfbpyhyznyufijrdry.supabase.co/functions/v1/kommo-report-snapshot',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key
      ),
      body := jsonb_build_object('workspace_id', ws.workspace_id, 'months', 12, 'cron', true),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$$;

revoke all on function kommo.trigger_report_snapshot_all() from public;

select cron.unschedule('kommo-report-snapshot-daily')
  where exists (select 1 from cron.job where jobname = 'kommo-report-snapshot-daily');
select cron.schedule(
  'kommo-report-snapshot-daily',
  '10 3 * * *',
  $tick$ select kommo.trigger_report_snapshot_all(); $tick$
);
