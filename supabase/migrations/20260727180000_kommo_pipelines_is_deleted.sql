-- Funis apagados no Kommo continuavam para sempre em kommo.pipelines: o passo de
-- pipelines do `kommo-sync` só fazia upsert, sem reconciliação de exclusão (ao
-- contrário dos leads, que já ganharam `is_deleted` no full-scan diário).
-- Resultado: funis inexistentes apareciam nos seletores de funil (Dashboard,
-- Relatórios, Configurações) e entravam nos cálculos quando não há funil padrão.
--
-- Aqui: coluna `is_deleted` (soft delete). O `kommo-sync` marca `true` nos funis
-- que não vieram mais da API e `false` nos que voltaram. Soft delete (e não DELETE)
-- porque leads históricos referenciam `pipeline_id` por texto — apagar a linha
-- deixaria o histórico sem nome de funil.

ALTER TABLE kommo.pipelines
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN kommo.pipelines.is_deleted IS
  'true = funil não veio mais no snapshot do Kommo (apagado lá). Mantido para o histórico; escondido dos seletores.';

-- Leitura filtrada por workspace + vivos (padrão dos seletores).
CREATE INDEX IF NOT EXISTS idx_kommo_pipelines_ws_alive
  ON kommo.pipelines (workspace_id)
  WHERE is_deleted = false AND is_archive = false;
