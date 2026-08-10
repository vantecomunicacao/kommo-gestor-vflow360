-- Seed de dados FICTÍCIOS para teste visual do dashboard.
-- Workspace "Clinica Modelo": clínica de estética/cirurgia plástica simulada.
--   - Últimos 3 meses (2 meses cheios + mês corrente até hoje)
--   - ~57 leads ganhos/mês, ticket uniforme R$5k-30k -> média ~R$1M/mês em vendas
--   - ~90 leads perdidos/mês e ~110 ainda em andamento (funil realista, não só vendas)
-- Etapas do pipeline nomeadas para o inferidor de fase do dashboard reconhecer
-- automaticamente (kommo-dashboard/index.ts inferFunnelMapping), sem precisar de
-- mapeamento manual em Configurações.
-- Idempotente: apaga o workspace pelo nome (cascata) antes de recriar.

BEGIN;

DELETE FROM kommo.workspaces WHERE name = 'Clinica Modelo';

DO $$
DECLARE
  ws_id uuid;
  owner uuid := 'b9f00fbf-7f36-4972-a973-ecc891b2aeb8';
  first_names text[] := ARRAY['Maria','Joao','Ana','Pedro','Juliana','Lucas','Fernanda','Rafael',
    'Camila','Bruno','Larissa','Diego','Patricia','Felipe','Aline','Thiago',
    'Carolina','Marcos','Vanessa','Gustavo','Priscila','Andre','Renata','Eduardo'];
  last_names text[] := ARRAY['Fernandes','Silva','Costa','Oliveira','Souza','Pereira','Rodrigues',
    'Almeida','Ribeiro','Carvalho','Gomes','Martins','Araujo','Barbosa','Teixeira'];
  procedures text[] := ARRAY['Avaliacao Estetica','Harmonizacao Facial','Preenchimento Labial',
    'Aplicacao de Botox','Lipoaspiracao','Mamoplastia','Rinoplastia','Abdominoplastia',
    'Implante Capilar','Design de Sobrancelha + Micropigmentacao','Peeling a Laser','Odontologia Estetica'];
  sources text[] := ARRAY['Instagram Ads','Google Ads','Indicacao','WhatsApp','Facebook Ads','Site'];
  sellers text[] := ARRAY['101','102','103','104'];
  stages text[] := ARRAY['1','2','3','4'];
  loss_ids text[] := ARRAY['1','2','3','4','5'];
  contact_count int := 150;
  m int; i int;
  lead_seq int := 0;
  month_start timestamptz;
  month_end timestamptz;
  created_ts timestamptz;
  price numeric;
  contact_idx int;
  cname text; cphone text; cemail text;
  proc_name text;
BEGIN
  INSERT INTO kommo.workspaces (name, owner_id) VALUES ('Clinica Modelo', owner) RETURNING id INTO ws_id;
  INSERT INTO kommo.workspace_members (workspace_id, user_id, role) VALUES (ws_id, owner, 'owner');

  INSERT INTO kommo.pipelines (workspace_id, kommo_id, name, sort, is_main, statuses) VALUES (
    ws_id, '1', 'Funil Comercial', 1, true,
    '[
      {"id":"1",  "name":"Novo Lead",         "sort":10,"type":1,"color":"#c1c1c1"},
      {"id":"2",  "name":"Contato Realizado",  "sort":20,"type":0,"color":"#99ccff"},
      {"id":"3",  "name":"Proposta Enviada",   "sort":30,"type":0,"color":"#ffcc66"},
      {"id":"4",  "name":"Negociacao",         "sort":40,"type":0,"color":"#ff9933"},
      {"id":"142","name":"Venda Ganha",        "sort":50,"type":1,"color":"#CCFF66"},
      {"id":"143","name":"Venda Perdida",      "sort":60,"type":1,"color":"#D5D8DB"}
    ]'::jsonb
  );

  INSERT INTO kommo.users (workspace_id, kommo_id, name, email, is_active, is_admin) VALUES
    (ws_id,'101','Ana Souza','ana.souza@clinicamodelo.example',true,false),
    (ws_id,'102','Carlos Lima','carlos.lima@clinicamodelo.example',true,false),
    (ws_id,'103','Beatriz Alves','beatriz.alves@clinicamodelo.example',true,false),
    (ws_id,'104','Rafael Torres','rafael.torres@clinicamodelo.example',true,false);

  INSERT INTO kommo.loss_reasons (workspace_id, kommo_id, name, sort) VALUES
    (ws_id,'1','Achou caro',1),
    (ws_id,'2','Nao respondeu',2),
    (ws_id,'3','Escolheu concorrente',3),
    (ws_id,'4','Desistiu do procedimento',4),
    (ws_id,'5','Fora da regiao',5);

  INSERT INTO kommo.custom_fields (workspace_id, kommo_id, entity_type, name, code, field_type, is_predefined, sort) VALUES
    (ws_id,'201','leads','Origem UTM','UTM_SOURCE','text',true,1),
    (ws_id,'202','leads','Midia UTM','UTM_MEDIUM','text',true,2),
    (ws_id,'301','contacts','Telefone','PHONE','text',true,1),
    (ws_id,'302','contacts','E-mail','EMAIL','text',true,2);

  -- contatos ficticios (pool reaproveitado pelos leads)
  FOR i IN 1..contact_count LOOP
    INSERT INTO kommo.contacts (workspace_id, kommo_id, name, phone, email) VALUES (
      ws_id, i::text,
      first_names[1+floor(random()*array_length(first_names,1))::int] || ' ' ||
        last_names[1+floor(random()*array_length(last_names,1))::int],
      '+55 11 9' || lpad((floor(random()*100000000))::text, 8, '0'),
      'paciente' || i || '@exemplo.com'
    );
  END LOOP;

  -- 3 meses: m=2 (2 meses atras) .. m=0 (mes corrente, ate hoje)
  FOR m IN REVERSE 2..0 LOOP
    month_start := date_trunc('month', now()) - (m || ' months')::interval;
    month_end := LEAST(month_start + interval '1 month', now());

    -- ganhos: ~57/mes, ticket uniforme 5k-30k (media ~17.5k) -> ~R$1M/mes
    FOR i IN 1..57 LOOP
      lead_seq := lead_seq + 1;
      created_ts := month_start + (random() * extract(epoch FROM (month_end - month_start))) * interval '1 second';
      price := round((5000 + random()*25000)::numeric, -2);
      contact_idx := 1 + floor(random()*contact_count)::int;
      SELECT name, phone, email INTO cname, cphone, cemail FROM kommo.contacts WHERE workspace_id = ws_id AND kommo_id = contact_idx::text;
      proc_name := procedures[1+floor(random()*array_length(procedures,1))::int];

      INSERT INTO kommo.leads (
        workspace_id, kommo_id, name, pipeline_id, status_id, status, price,
        responsible_user_id, source, contact_id, contact_name, contact_phone, contact_email,
        kommo_created_at, kommo_updated_at, closed_at, last_status_change_at
      ) VALUES (
        ws_id, lead_seq::text, proc_name || ' - ' || cname, '1', '142', 'won', price,
        sellers[1+floor(random()*4)::int], sources[1+floor(random()*6)::int],
        contact_idx::text, cname, cphone, cemail,
        created_ts, created_ts + interval '1 day' * floor(random()*5),
        created_ts + interval '1 day' * (1+floor(random()*20)),
        created_ts + interval '1 day' * floor(random()*5)
      );
    END LOOP;

    -- perdidos: ~90/mes
    FOR i IN 1..90 LOOP
      lead_seq := lead_seq + 1;
      created_ts := month_start + (random() * extract(epoch FROM (month_end - month_start))) * interval '1 second';
      price := round((5000 + random()*25000)::numeric, -2);
      contact_idx := 1 + floor(random()*contact_count)::int;
      SELECT name, phone, email INTO cname, cphone, cemail FROM kommo.contacts WHERE workspace_id = ws_id AND kommo_id = contact_idx::text;
      proc_name := procedures[1+floor(random()*array_length(procedures,1))::int];

      INSERT INTO kommo.leads (
        workspace_id, kommo_id, name, pipeline_id, status_id, status, price,
        responsible_user_id, loss_reason_id, source, contact_id, contact_name, contact_phone, contact_email,
        kommo_created_at, kommo_updated_at, closed_at, last_status_change_at
      ) VALUES (
        ws_id, lead_seq::text, proc_name || ' - ' || cname, '1', '143', 'lost', price,
        sellers[1+floor(random()*4)::int], loss_ids[1+floor(random()*5)::int], sources[1+floor(random()*6)::int],
        contact_idx::text, cname, cphone, cemail,
        created_ts, created_ts + interval '1 day' * floor(random()*5),
        created_ts + interval '1 day' * (1+floor(random()*20)),
        created_ts + interval '1 day' * floor(random()*5)
      );
    END LOOP;

    -- em andamento: ~110/mes, distribuidos pelas 4 etapas abertas
    FOR i IN 1..110 LOOP
      lead_seq := lead_seq + 1;
      created_ts := month_start + (random() * extract(epoch FROM (month_end - month_start))) * interval '1 second';
      price := round((5000 + random()*25000)::numeric, -2);
      contact_idx := 1 + floor(random()*contact_count)::int;
      SELECT name, phone, email INTO cname, cphone, cemail FROM kommo.contacts WHERE workspace_id = ws_id AND kommo_id = contact_idx::text;
      proc_name := procedures[1+floor(random()*array_length(procedures,1))::int];

      INSERT INTO kommo.leads (
        workspace_id, kommo_id, name, pipeline_id, status_id, status, price,
        responsible_user_id, source, contact_id, contact_name, contact_phone, contact_email,
        kommo_created_at, kommo_updated_at, last_status_change_at
      ) VALUES (
        ws_id, lead_seq::text, proc_name || ' - ' || cname, '1', stages[1+floor(random()*4)::int], 'open', price,
        sellers[1+floor(random()*4)::int], sources[1+floor(random()*6)::int],
        contact_idx::text, cname, cphone, cemail,
        created_ts, created_ts + interval '1 day' * floor(random()*5),
        created_ts + interval '1 day' * floor(random()*5)
      );
    END LOOP;
  END LOOP;

  INSERT INTO kommo.dashboard_settings (workspace_id, default_pipeline_ids, won_stage_keys)
  VALUES (ws_id, ARRAY['1'], ARRAY['142']);

  INSERT INTO kommo.sync_status (workspace_id, last_sync_at, last_sync_status, leads_count, is_running)
  SELECT ws_id, now(), 'success', count(*), false FROM kommo.leads WHERE workspace_id = ws_id;
END $$;

COMMIT;

-- Resumo pos-insercao
SELECT
  count(*) FILTER (WHERE status = 'won')  AS won,
  count(*) FILTER (WHERE status = 'lost') AS lost,
  count(*) FILTER (WHERE status = 'open') AS open,
  count(*) AS total_leads,
  round(sum(price) FILTER (WHERE status = 'won')) AS receita_total_won,
  round(sum(price) FILTER (WHERE status = 'won') / 3) AS receita_media_mensal
FROM kommo.leads l
JOIN kommo.workspaces w ON w.id = l.workspace_id
WHERE w.name = 'Clinica Modelo';
