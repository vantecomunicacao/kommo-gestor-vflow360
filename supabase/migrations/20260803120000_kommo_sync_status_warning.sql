-- ============================================================================
-- Aviso não-fatal de sync (ex.: teto de páginas de contacts atingido — dado
-- pode estar incompleto mesmo com last_sync_status = 'success'). Antes disso
-- só existia last_sync_error (falha dura); isso cobre o caso "deu certo, mas
-- com ressalva".
-- Additive: schema kommo apenas; não toca em public/GHL.
-- ============================================================================

alter table kommo.sync_status add column if not exists last_sync_warning text;
