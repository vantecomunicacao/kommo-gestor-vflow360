-- ============================================================================
-- Fase 1.6 do plano de remediação — Watchdog de sync obsoleto.
--
-- Contexto: os crons `postgres -> edge` (kommo-sync-tick 12h, kommo-sync-full-daily)
-- são "dispara e esquece" (net.http_post sem retry). Se uma invocação falha (cold
-- start, timeout, erro transitório), aquele workspace simplesmente perde o tick —
-- o full-scan diário costuma cobrir, mas ninguém é AVISADO se ficar parado.
--
-- Este cron diário verifica, para cada integração Kommo CONECTADA, se o
-- sync_status está velho (> STALE_HOURS) ou em erro, e dispara o webhook de erro
-- dedicado (mesmo canal do errorReporter.ts / notifySyncFailure do kommo-sync).
--
-- PRÉ-REQUISITO (item 1.3 do plano — rodar UMA vez, com a URL do webhook NOVO,
-- dedicado ao VFlowKommo, NÃO o compartilhado "erro-lovable"):
--   select vault.create_secret(
--     'https://SEU-WEBHOOK-DEDICADO/...',
--     'kommo_error_webhook_url',
--     'Webhook de erro dedicado (VFlowKommo) — usado pelo watchdog de sync'
--   );
-- Sem esse secret, a função NÃO falha — só não dispara alerta (RAISE NOTICE apenas).
--
-- Aditiva: schema kommo + vault + cron job próprio. Não toca em tabela existente,
-- não toca em public/GHL.
-- ============================================================================

-- Leitor do webhook de erro (SECURITY DEFINER: só o dono acessa o Vault).
create or replace function kommo.error_webhook_url()
returns text
language sql
security definer
set search_path = kommo, vault, public
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name = 'kommo_error_webhook_url'
  limit 1;
$$;

revoke all on function kommo.error_webhook_url() from public;

-- ---------------------------------------------------------------------------
-- Watchdog: alerta workspaces conectados cujo sync está velho ou em erro.
-- ---------------------------------------------------------------------------
create or replace function kommo.check_stale_syncs()
returns void
language plpgsql
security definer
set search_path = kommo, public
as $$
declare
  ws            record;
  webhook_url   text := kommo.error_webhook_url();
  stale_hours   int  := 26;   -- full-scan é diário; 26h dá folga p/ 1 ciclo perdido
  last_at       timestamptz;
  last_status   text;
  last_error    text;
  reason        text;
begin
  for ws in
    select i.workspace_id, w.name as workspace_name
    from kommo.integrations i
    join kommo.workspaces w on w.id = i.workspace_id
    where i.type = 'kommo'
      and i.status = 'connected'
      and i.workspace_id is not null
      and w.deleted_at is null
  loop
    select s.last_sync_at, s.last_sync_status, s.last_sync_error
      into last_at, last_status, last_error
    from kommo.sync_status s
    where s.workspace_id = ws.workspace_id;

    reason := null;
    if last_at is null then
      reason := 'nunca sincronizou (sem sync_status)';
    elsif last_at < now() - make_interval(hours => stale_hours) then
      reason := format('último sync em %s (> %sh atrás)', last_at, stale_hours);
    elsif last_status = 'error' then
      reason := format('último sync terminou em ERRO: %s', coalesce(left(last_error, 300), 'sem detalhe'));
    end if;

    if reason is null then
      continue;
    end if;

    raise notice 'kommo watchdog: workspace % (%) — %', ws.workspace_id, ws.workspace_name, reason;

    if webhook_url is not null and webhook_url <> '' then
      perform net.http_post(
        url := webhook_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'project', 'VFlowKommo',
          'level', 'error',
          'source', 'cron:kommo-sync-staleness',
          'message', format('Sync do Kommo parado/instável (workspace "%s" / %s): %s',
                            ws.workspace_name, ws.workspace_id, reason),
          'workspace_id', ws.workspace_id,
          'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ),
        timeout_milliseconds := 15000
      );
    end if;
  end loop;
end;
$$;

revoke all on function kommo.check_stale_syncs() from public;

-- Agenda diária — 07:30 UTC (depois do full-scan das 06:20, p/ não alarmar
-- por um workspace que está no meio de um full-scan). Recria se já existir.
select cron.unschedule('kommo-sync-staleness-check')
  where exists (select 1 from cron.job where jobname = 'kommo-sync-staleness-check');
select cron.schedule(
  'kommo-sync-staleness-check',
  '30 7 * * *',
  $watch$ select kommo.check_stale_syncs(); $watch$
);
