-- VFlow360 Kommo — sync incremental por watermark
-- Estende kommo.sync_watermarks para guardar o marco de sincronização por entidade,
-- não só de leads. Assim o kommo-sync passa a puxar apenas o que mudou desde a última
-- rodada (filter[updated_at][from] / filter[created_at][from] na API do Kommo), com
-- full-scan como fallback quando o watermark está ausente (1ª sync ou pós-troca de conta).
--
-- Não cria/renomeia tabelas — só adiciona colunas nullable (nenhum backfill: NULL = "nunca
-- sincronizado" = full-scan na próxima rodada, que é o comportamento seguro desejado).

ALTER TABLE kommo.sync_watermarks
  ADD COLUMN IF NOT EXISTS contacts_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS tasks_last_seen_at    timestamptz,
  ADD COLUMN IF NOT EXISTS events_last_seen_at   timestamptz;

COMMENT ON COLUMN kommo.sync_watermarks.leads_last_seen_at    IS 'Marco do último sync de leads (filter[updated_at][from]). NULL = full-scan.';
COMMENT ON COLUMN kommo.sync_watermarks.contacts_last_seen_at IS 'Marco do último sync de contatos (filter[updated_at][from]). NULL = full-scan.';
COMMENT ON COLUMN kommo.sync_watermarks.tasks_last_seen_at    IS 'Marco do último sync de tarefas (filter[updated_at][from]). NULL = full-scan.';
COMMENT ON COLUMN kommo.sync_watermarks.events_last_seen_at   IS 'Marco do último sync de eventos de etapa (filter[created_at][from]). NULL = full-scan.';
