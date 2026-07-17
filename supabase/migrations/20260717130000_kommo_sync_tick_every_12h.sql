-- ============================================================================
-- Reduz a frequência do sync incremental do Kommo: 15 min -> 12 h.
--
-- Motivo: o dashboard é consultado poucas vezes por mês, então rodar o tick a
-- cada 15 min (~2.880x/mês) é desperdício de chamadas à API do Kommo, escrita no
-- banco e invocações de edge function. 12 h (00:00 e 12:00 UTC ≈ 21h e 9h BRT)
-- dá 2 refreshes/dia; somados ao full-scan diário (kommo-sync-full-daily, 06:20
-- UTC) cobrem bem o uso real. Se a tela /cooling-leads (vendedores) parecer
-- defasada, basta subir para 6h ('0 */6 * * *').
--
-- Só reagenda o job existente `kommo-sync-tick` (não altera a função
-- kommo.trigger_sync_all nem toca em public/GHL).
-- ============================================================================

select cron.unschedule('kommo-sync-tick')
  where exists (select 1 from cron.job where jobname = 'kommo-sync-tick');
select cron.schedule(
  'kommo-sync-tick',
  '0 */12 * * *',
  $tick$ select kommo.trigger_sync_all(); $tick$
);
