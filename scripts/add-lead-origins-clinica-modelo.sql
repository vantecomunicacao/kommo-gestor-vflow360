-- Popula UTM_SOURCE/UTM_MEDIUM/UTM_CAMPAIGN em kommo.leads.custom_fields pro
-- workspace ficticio "Clinica Modelo". O card "Origem" ja funcionava (fallback
-- pra l.source, ver getOrigin em kommo-dashboard/index.ts:174), mas os filtros
-- "Tipo de origem" (UTM_MEDIUM) e "Campanha" (UTM_CAMPAIGN) so leem de
-- custom_fields (sem fallback) — ficavam vazios. UTM_SOURCE aqui espelha
-- l.source, entao o card de Origem nao muda, so passa a existir via custom
-- field tambem (like num Kommo real).

DO $$
DECLARE
  ws_id uuid;
BEGIN
  SELECT id INTO ws_id FROM kommo.workspaces WHERE name = 'Clinica Modelo';
  IF ws_id IS NULL THEN
    RAISE EXCEPTION 'Workspace "Clinica Modelo" nao encontrado';
  END IF;

  INSERT INTO kommo.custom_fields (workspace_id, kommo_id, entity_type, name, code, field_type, is_predefined, sort)
  VALUES (ws_id, '203', 'leads', 'Campanha UTM', 'UTM_CAMPAIGN', 'text', true, 3)
  ON CONFLICT (workspace_id, entity_type, kommo_id) DO NOTHING;

  UPDATE kommo.leads l
  SET custom_fields = jsonb_build_array(
    jsonb_build_object('field_id', '201', 'field_code', 'UTM_SOURCE', 'values', jsonb_build_array(jsonb_build_object('value', l.source))),
    jsonb_build_object('field_id', '202', 'field_code', 'UTM_MEDIUM', 'values', jsonb_build_array(jsonb_build_object('value', mm.medium))),
    jsonb_build_object('field_id', '203', 'field_code', 'UTM_CAMPAIGN', 'values', jsonb_build_array(jsonb_build_object('value', mm.campaigns[1 + floor(random() * array_length(mm.campaigns, 1))::int])))
  )
  FROM (VALUES
    ('Instagram Ads', 'paid-social', ARRAY['ig_avaliacao_gratis', 'ig_promo_botox', 'ig_remarketing_verao']),
    ('Facebook Ads',  'paid-social', ARRAY['fb_lookalike_pacientes', 'fb_promo_lipo', 'fb_leads_form']),
    ('Google Ads',    'paid-search', ARRAY['gads_pesquisa_clinica_estetica', 'gads_pmax_procedimentos', 'gads_remarketing']),
    ('Site',          'organic',     ARRAY['organico_blog', 'organico_site_direto']),
    ('WhatsApp',      'direct',      ARRAY['whatsapp_direto']),
    ('Indicacao',     'referral',    ARRAY['indicacao_paciente', 'indicacao_parceria_dermato'])
  ) AS mm(src, medium, campaigns)
  WHERE l.workspace_id = ws_id AND l.source = mm.src;
END $$;

-- Resumo pos-insercao: distribuicao de origem/midia/campanha
SELECT
  l.custom_fields #>> '{0,values,0,value}' AS utm_source,
  l.custom_fields #>> '{1,values,0,value}' AS utm_medium,
  count(*) AS n
FROM kommo.leads l JOIN kommo.workspaces w ON w.id = l.workspace_id
WHERE w.name = 'Clinica Modelo'
GROUP BY 1, 2 ORDER BY 3 DESC;
