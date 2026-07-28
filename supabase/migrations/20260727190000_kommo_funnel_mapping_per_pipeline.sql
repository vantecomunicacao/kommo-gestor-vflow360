-- `kommo.dashboard_settings.funnel_stage_mapping` passa a ser indexado pelo PAR
-- funil+etapa: chave "<pipeline_kommo_id>:<status_id>" no lugar de só "<status_id>".
--
-- Motivo: no Kommo os status de sistema `142` (Venda ganha) e `143` (Venda perdida)
-- têm o MESMO id em todos os funis, e clientes os renomeiam por funil (na conta do
-- Dr. Eduardo, o `142` do funil "05 | Equipe Multidisciplinar" chama-se "Cirurgia
-- Realizada"). Com uma chave por status, configurar uma etapa num funil contaminava
-- todos os outros.
--
-- Esta migration é de DADOS e preserva o comportamento atual: cada chave legada é
-- expandida para todos os funis do workspace que contêm aquele status. Chaves já no
-- formato novo são mantidas. Sem mudança estrutural — a coluna continua jsonb — e o
-- leitor (_shared/kommo-funnel.ts) ainda aceita o formato antigo, então rodar isto
-- fora de ordem com o deploy não quebra nada.

WITH legacy AS (
  SELECT d.workspace_id, m.key AS status_id, m.value AS bucket
  FROM kommo.dashboard_settings d,
       LATERAL jsonb_each(COALESCE(d.funnel_stage_mapping, '{}'::jsonb)) m
  WHERE POSITION(':' IN m.key) = 0
),
expanded AS (
  -- A mesma etapa pode existir em vários funis (142/143 existem em todos):
  -- a regra legada vira uma regra por funil, preservando o resultado atual.
  SELECT l.workspace_id, p.kommo_id || ':' || l.status_id AS key, l.bucket
  FROM legacy l
  JOIN kommo.pipelines p
    ON p.workspace_id = l.workspace_id
   AND p.statuses @> jsonb_build_array(jsonb_build_object('id', l.status_id))
),
novo AS (
  SELECT workspace_id, jsonb_object_agg(key, bucket) AS mapping
  FROM expanded GROUP BY workspace_id
),
mantido AS (
  -- chaves que já estavam no formato novo
  SELECT d.workspace_id, jsonb_object_agg(m.key, m.value) AS mapping
  FROM kommo.dashboard_settings d,
       LATERAL jsonb_each(COALESCE(d.funnel_stage_mapping, '{}'::jsonb)) m
  WHERE POSITION(':' IN m.key) > 0
  GROUP BY d.workspace_id
)
UPDATE kommo.dashboard_settings d
SET funnel_stage_mapping =
      COALESCE((SELECT mapping FROM novo n WHERE n.workspace_id = d.workspace_id), '{}'::jsonb)
      || COALESCE((SELECT mapping FROM mantido k WHERE k.workspace_id = d.workspace_id), '{}'::jsonb)
WHERE EXISTS (SELECT 1 FROM legacy l WHERE l.workspace_id = d.workspace_id);
