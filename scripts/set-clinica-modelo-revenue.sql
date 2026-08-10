-- Ajusta o preco dos leads GANHOS do workspace ficticio "Clinica Modelo" pra
-- bater exatamente o faturamento pedido por mes (soma de kommo.leads.price
-- onde status='won'), redistribuindo entre os leads daquele mes com pesos
-- aleatorios (mantem os tickets dentro de R$5.000-30.000, so muda o mix).
--
-- Metas:
--   Junho/2026   -> R$ 857.320,00
--   Julho/2026   -> R$ 983.531,00
--   Agosto/2026  -> R$ 793.000,00

DO $$
DECLARE
  ws_id uuid;
  mo text;
  target numeric;
  targets jsonb := '{"2026-06":857320.00,"2026-07":983531.00,"2026-08":793000.00}'::jsonb;
  min_p numeric := 5000;
  n int;
  total_w numeric;
  base numeric;
  diff numeric;
  fix_id uuid;
BEGIN
  SELECT id INTO ws_id FROM kommo.workspaces WHERE name = 'Clinica Modelo';
  IF ws_id IS NULL THEN
    RAISE EXCEPTION 'Workspace "Clinica Modelo" nao encontrado';
  END IF;

  FOR mo, target IN SELECT key, value::numeric FROM jsonb_each_text(targets) LOOP
    DROP TABLE IF EXISTS tmp_alloc;
    CREATE TEMP TABLE tmp_alloc AS
    SELECT id, random() AS w
    FROM kommo.leads
    WHERE workspace_id = ws_id AND status = 'won'
      AND to_char(kommo_created_at, 'YYYY-MM') = mo;

    SELECT count(*), sum(w) INTO n, total_w FROM tmp_alloc;
    base := target - n * min_p;

    UPDATE kommo.leads l
    SET price = round((min_p + (t.w / total_w) * base)::numeric, 2)
    FROM tmp_alloc t
    WHERE l.id = t.id;

    -- corrige o resto do arredondamento (poucos centavos) no maior ticket do mes
    SELECT round(target - sum(price), 2) INTO diff FROM kommo.leads WHERE id IN (SELECT id FROM tmp_alloc);
    IF diff <> 0 THEN
      SELECT id INTO fix_id FROM kommo.leads WHERE id IN (SELECT id FROM tmp_alloc) ORDER BY price DESC LIMIT 1;
      UPDATE kommo.leads SET price = price + diff WHERE id = fix_id;
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS tmp_alloc;
END $$;

SELECT to_char(kommo_created_at, 'YYYY-MM') AS mo, count(*) AS won,
       round(sum(price), 2) AS total, round(min(price), 2) AS min_p, round(max(price), 2) AS max_p
FROM kommo.leads l JOIN kommo.workspaces w ON w.id = l.workspace_id
WHERE w.name = 'Clinica Modelo' AND l.status = 'won'
GROUP BY 1 ORDER BY 1;
