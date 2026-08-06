-- ============================================================================
-- Fix de drift: migrations anteriores (20260709130000, 20260721120000) ainda
-- referenciavam o projeto Supabase ANTIGO (xcrfbpyhyznyufijrdry) nas 3 funções
-- de cron. As funções em produção JÁ foram corrigidas manualmente pra apontar
-- pro projeto novo (fjncmmqvmocwykpshgsh) depois da separação de infra de
-- 2026-08-02, mas essa correção nunca voltou pro repositório — encontrado na
-- auditoria de 2026-08-05 (Fase 0 do plano de remediação técnica).
--
-- Esta migration só re-captura o estado que já está rodando em produção
-- (mesma URL/anon key que as funções vivas), pra fechar a divergência
-- repo-vs-banco. Não muda comportamento nenhum.
--
-- Additive/idempotente (create or replace); só schema kommo; não toca em
-- public/GHL.
-- ============================================================================

create or replace function kommo.trigger_sync_all()
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
      url := 'https://fjncmmqvmocwykpshgsh.supabase.co/functions/v1/kommo-sync',
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

create or replace function kommo.trigger_sync_all_full()
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
      url := 'https://fjncmmqvmocwykpshgsh.supabase.co/functions/v1/kommo-sync',
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
      body := jsonb_build_object('workspace_id', ws.workspace_id, 'months', 12, 'cron', true),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$$;

revoke all on function kommo.trigger_report_snapshot_all() from public;
