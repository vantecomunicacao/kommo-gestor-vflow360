-- ============================================================================
-- Provedor de IA por usuário (schema kommo).
-- A tela Configurações › IA grava aqui a chave OpenAI/modelo de cada conta. O app
-- aponta para o schema `kommo` (client.ts), então a tabela PRECISA existir em
-- `kommo` — antes a gravação ia para `public.ai_provider_config` (GHL) e falhava
-- silenciosamente ("não salva"). Espelha a estrutura da versão public, isolada.
-- Lida também pela edge kommo-ai-analyze (chave do owner do workspace).
-- Additive: schema kommo apenas; não toca em public/GHL.
-- ============================================================================

create table if not exists kommo.ai_provider_config (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  provider   text not null default 'openai',
  api_key    text,
  model      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table kommo.ai_provider_config enable row level security;

-- Cada usuário só enxerga/gerencia a própria configuração; service role acessa tudo
-- (a edge lê a chave do owner do workspace).
create policy "own select" on kommo.ai_provider_config
  for select using (auth.uid() = user_id);
create policy "own insert" on kommo.ai_provider_config
  for insert with check (auth.uid() = user_id);
create policy "own update" on kommo.ai_provider_config
  for update using (auth.uid() = user_id);
create policy "svc all" on kommo.ai_provider_config
  for all to service_role using (true) with check (true);

create trigger trg_kommo_ai_provider_config_upd
  before update on kommo.ai_provider_config
  for each row execute function kommo.set_updated_at();

grant select, insert, update, delete on kommo.ai_provider_config to authenticated, service_role;
