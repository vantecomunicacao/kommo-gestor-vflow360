-- ============================================================================
-- Análise IA do Dashboard sob demanda — histórico das análises geradas.
-- O gestor escreve um prompt livre; a edge function kommo-ai-analyze interpreta
-- (período/funil/comparação), busca os números reais via kommo-dashboard e gera
-- uma análise em texto. Cada análise gerada vira uma linha aqui (histórico).
-- Uma linha por análise (workspace × usuário × momento).
--  - `params`  jsonb: parâmetros CONFIRMADOS (funil, período, eixo, comparação).
--  - `metrics` jsonb: snapshot compacto dos números usados (rastreabilidade).
--  - custo do modelo gravado aqui mesmo (não em public.ai_usage_log, que é do GHL).
-- Additive: schema kommo apenas; não toca em public/GHL.
-- ============================================================================

create table if not exists kommo.dashboard_analyses (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references kommo.workspaces(id) on delete cascade,
  user_id      uuid,                                        -- quem gerou (auth.users.id)
  prompt       text not null,                               -- pedido livre do gestor
  params       jsonb not null default '{}'::jsonb,          -- funil/período/eixo/comparação confirmados
  result       text not null default '',                    -- análise gerada (texto)
  metrics      jsonb not null default '{}'::jsonb,          -- snapshot dos números usados
  model        text,                                        -- ex.: gpt-4o-mini
  cost_usd     numeric(12,6) not null default 0,            -- custo estimado da geração
  created_at   timestamptz not null default now()
);

create index if not exists dashboard_analyses_lookup_idx
  on kommo.dashboard_analyses (workspace_id, created_at desc);

alter table kommo.dashboard_analyses enable row level security;

-- Membros do workspace leem o histórico. A escrita é feita pela edge function via
-- service role (que ignora RLS), então não há policy de insert/update p/ usuários.
create policy "members select" on kommo.dashboard_analyses
  for select using (kommo.is_workspace_member(auth.uid(), workspace_id));

-- Service role: acesso total (a edge grava as análises).
create policy "svc all" on kommo.dashboard_analyses
  for all to service_role using (true) with check (true);

-- Privilégios de tabela (RLS não dispensa GRANT). Mesmo padrão das demais tabelas kommo.
grant select, insert, update, delete on kommo.dashboard_analyses to authenticated, service_role;
