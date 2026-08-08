-- ============================================================================
-- Trava definitiva ("period lock") dos meses do Relatório.
--
-- Motivo: hoje kommo-report-snapshot recalcula TODO mês a cada rodada, usando o
-- status ATUAL do lead — um lead reaberto e fechado de novo meses depois muda
-- silenciosamente um número que já foi mostrado/exportado pro usuário. Isso
-- contraria a premissa de "foto congelada" (o mesmo padrão de "fechamento
-- contábil" usado em sistemas financeiros/BI maduros: uma vez fechado, só nova
-- atividade no período CORRENTE reflete mudanças, nunca uma reescrita silenciosa
-- do passado).
--
-- Esta migration só adiciona a coluna; a lógica que decide QUANDO travar (grace
-- period de 3 dias após o fechamento do mês OU a conexão do workspace, o que for
-- mais tarde) vive em supabase/functions/kommo-report-snapshot/index.ts.
--
-- Aditiva; RLS existente na tabela já cobre a coluna nova automaticamente
-- (não precisa de policy nova). Só schema kommo; não toca em public/GHL.
-- ============================================================================

alter table kommo.report_snapshots
  add column if not exists locked boolean not null default false,
  add column if not exists locked_at timestamptz;
