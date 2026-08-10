-- Adiciona 2 métricas personalizadas ao workspace ficticio "Clinica Modelo":
--   - Taxa de Agendamento: % de leads FECHADOS (ganhos+perdidos) que em algum
--     momento passaram pela etapa "Agendado".
--   - Taxa de No-show: % de leads FECHADOS que em algum momento passaram pela
--     etapa "Nao Compareceu".
-- (kommo.dashboard_settings.custom_metrics; numerador = "passou por" via
-- kommo.lead_stage_events, denominador = "esta em" via status atual — mesma
-- semantica usada por supabase/functions/kommo-dashboard/index.ts.)
--
-- Pre-requisito: pipeline nao tinha essas etapas, entao tambem:
--   1. adiciona os status "5" (Agendado) e "6" (Nao Compareceu) ao pipeline
--   2. gera eventos ficticios de passagem por essas etapas pros leads ja
--      fechados (~75% agendados, ~27% desses com no-show), pra a métrica ter
--      numeros reais
--   3. move uma amostra de leads "em andamento" pra ficarem literalmente
--      parados nessas etapas agora
-- Idempotente: reroda limpando os eventos sinteticos antes de regerar.

DO $$
DECLARE
  ws_id uuid;
  r record;
  sched_at timestamptz;
  noshow_at timestamptz;
BEGIN
  SELECT id INTO ws_id FROM kommo.workspaces WHERE name = 'Clinica Modelo';
  IF ws_id IS NULL THEN
    RAISE EXCEPTION 'Workspace "Clinica Modelo" nao encontrado - rode scripts/seed-clinica-modelo.sql primeiro';
  END IF;

  DELETE FROM kommo.lead_stage_events WHERE workspace_id = ws_id;

  UPDATE kommo.pipelines
  SET statuses = statuses || '[
    {"id":"5","name":"Agendado","sort":25,"type":0,"color":"#66CCFF"},
    {"id":"6","name":"Nao Compareceu","sort":26,"type":0,"color":"#FF6666"}
  ]'::jsonb
  WHERE workspace_id = ws_id AND kommo_id = '1'
    AND NOT (statuses @> '[{"id":"5"}]'::jsonb);

  -- leads fechados (won/lost): ~75% passaram por "Agendado"; desses, ~27% tiveram "Nao Compareceu"
  FOR r IN
    SELECT kommo_id, pipeline_id, kommo_created_at FROM kommo.leads
    WHERE workspace_id = ws_id AND status IN ('won', 'lost')
  LOOP
    IF random() < 0.75 THEN
      sched_at := r.kommo_created_at + interval '1 day' * (1 + floor(random() * 4));
      INSERT INTO kommo.lead_stage_events (workspace_id, event_id, lead_id, pipeline_id, before_status_id, after_status_id, changed_at)
      VALUES (ws_id, gen_random_uuid()::text, r.kommo_id, r.pipeline_id, '2', '5', sched_at);

      IF random() < 0.27 THEN
        noshow_at := sched_at + interval '1 day' * (1 + floor(random() * 2));
        INSERT INTO kommo.lead_stage_events (workspace_id, event_id, lead_id, pipeline_id, before_status_id, after_status_id, changed_at)
        VALUES (ws_id, gen_random_uuid()::text, r.kommo_id, r.pipeline_id, '5', '6', noshow_at);
      END IF;
    END IF;
  END LOOP;

  -- amostra de leads em andamento parados literalmente em Agendado / Nao Compareceu hoje
  UPDATE kommo.leads SET status_id = '5'
  WHERE id IN (
    SELECT id FROM kommo.leads WHERE workspace_id = ws_id AND status = 'open' AND status_id = '3'
    ORDER BY random() LIMIT 30
  );
  UPDATE kommo.leads SET status_id = '6'
  WHERE id IN (
    SELECT id FROM kommo.leads WHERE workspace_id = ws_id AND status = 'open' AND status_id = '4'
    ORDER BY random() LIMIT 10
  );

  UPDATE kommo.dashboard_settings
  SET custom_metrics = '[
    {
      "id": "taxa-agendamento",
      "name": "Taxa de Agendamento",
      "format": "percent",
      "icon": "calendar",
      "numerator": [{"pipelineId":"1","statusId":"5"}],
      "denominator": [{"pipelineId":"1","statusId":"142"},{"pipelineId":"1","statusId":"143"}]
    },
    {
      "id": "taxa-no-show",
      "name": "Taxa de No-show",
      "format": "percent",
      "icon": "clock",
      "numerator": [{"pipelineId":"1","statusId":"6"}],
      "denominator": [{"pipelineId":"1","statusId":"142"},{"pipelineId":"1","statusId":"143"}]
    }
  ]'::jsonb
  WHERE workspace_id = ws_id;
END $$;

-- Resumo pos-insercao
SELECT
  count(*) FILTER (WHERE status IN ('won','lost')) AS leads_fechados,
  count(*) FILTER (WHERE status IN ('won','lost') AND after5.n > 0) AS passaram_por_agendado,
  count(*) FILTER (WHERE status IN ('won','lost') AND after6.n > 0) AS passaram_por_noshow
FROM kommo.leads l
JOIN kommo.workspaces w ON w.id = l.workspace_id
LEFT JOIN LATERAL (SELECT count(*) AS n FROM kommo.lead_stage_events e WHERE e.workspace_id = w.id AND e.lead_id = l.kommo_id AND e.after_status_id = '5') after5 ON true
LEFT JOIN LATERAL (SELECT count(*) AS n FROM kommo.lead_stage_events e WHERE e.workspace_id = w.id AND e.lead_id = l.kommo_id AND e.after_status_id = '6') after6 ON true
WHERE w.name = 'Clinica Modelo';
