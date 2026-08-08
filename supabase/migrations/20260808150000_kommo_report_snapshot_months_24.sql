-- ============================================================================
-- Amplia a janela do cron diário de fotos mensais de 12 para 24 meses.
--
-- Motivo: a nova comparação "Comparar com: mesmo mês, ano passado" (YoY) no
-- Relatório precisa que exista o mês 12 meses antes de cada mês exibido. Com
-- janela de só 12 meses, o mês mais antigo do período padrão nunca teria uma
-- base 12 meses atrás — a comparação sempre cairia em "sem base de comparação".
-- 24 meses cobre YoY para o período padrão de 12 meses exibido no Relatório.
--
-- Custo: baixo. O full-scan de leads/lead_stage_events em
-- kommo-report-snapshot já lê o workspace inteiro independente de `months` —
-- esse parâmetro só decide quantas linhas mensais são geradas/gravadas no
-- final (ver kommo-report-snapshot/index.ts).
--
-- Só recria a função (mesma URL/anon key/secret já em produção desde
-- 20260805130000_kommo_cron_url_drift_fix.sql), trocando 'months', 12 por
-- 'months', 24. Additive/idempotente (create or replace); só schema kommo;
-- não toca em public/GHL.
-- ============================================================================

create or replace function kommo.trigger_report_snapshot_all()
returns void
language plpgsql
security definer
set search_path = kommo, public
as $$
declare
  ws record;
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqbmNtbXF2bW9jd3lrcHNoZ3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MTYxODgsImV4cCI6MjEwMTE5MjE4OH0.owryaM1T5bU_9yegYH95RtGJ8QQHQ-1dw6h8wJSWkFs';
  secret text := kommo.internal_function_secret();
begin
  for ws in
    select distinct workspace_id
    from kommo.integrations
    where type = 'kommo' and status = 'connected' and workspace_id is not null
  loop
    perform net.http_post(
      url := 'https://fjncmmqvmocwykpshgsh.supabase.co/functions/v1/kommo-report-snapshot',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key,
        'x-internal-secret', secret
      ),
      body := jsonb_build_object('workspace_id', ws.workspace_id, 'months', 24, 'cron', true),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$$;

revoke all on function kommo.trigger_report_snapshot_all() from public;
