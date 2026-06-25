-- ============================================================================
-- Fundação do schema `kommo` — app VFlow360 para o CRM Kommo.
--
-- ISOLAMENTO: tudo vive no schema dedicado `kommo`. O app GHL (`public.*`) NÃO é
-- tocado por esta migration. Mesmo projeto Supabase, schemas separados.
-- AUTOCONTIDO: função de trigger, enum e helpers próprios em `kommo` (não dependem
-- de `public`), para um eventual "porta de saída" (projeto separado) ser trivial.
--
-- GROUNDED em dados reais da conta Vante (account_id 32154887) inspecionados em
-- 2026-06-17 via /api/v4 (pipelines, leads, custom_fields, users, loss_reasons):
--   - IDs do Kommo são inteiros; guardamos como TEXT (reuso da lógica de funil que
--     já tratava ids como string; e status_id repete entre funis — 142/143).
--   - Timestamps vêm em unix epoch (seg). O sync converte para timestamptz.
--   - Ganho/perdido = status_id IN ('142','143'); etapa de entrada = status type 1.
--   - UTM é nativo (custom fields predefinidos com `code` UTM_SOURCE/MEDIUM/...).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS kommo;

-- PostgREST/Supabase: os roles precisam de USAGE no schema (RLS ainda controla linhas)
GRANT USAGE ON SCHEMA kommo TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Helpers próprios do schema (autocontidos)
-- ----------------------------------------------------------------------------

-- trigger updated_at
CREATE OR REPLACE FUNCTION kommo.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = kommo;

-- enum de roles (espelha public.app_role, mas próprio do schema)
DO $$ BEGIN
  CREATE TYPE kommo.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Camada de identidade (keyed por auth.uid() — auth.users é compartilhado)
-- ----------------------------------------------------------------------------

-- Perfis (criação é lazy pelo app no login; NÃO adicionamos trigger em auth.users
-- para não poluir/tocar o schema auth compartilhado com o app GHL).
CREATE TABLE kommo.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kommo.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role kommo.app_role NOT NULL DEFAULT 'user',
  UNIQUE (user_id, role)
);

CREATE TABLE kommo.user_permissions (
  user_id uuid PRIMARY KEY,
  view_suggestions boolean NOT NULL DEFAULT false,
  view_integrations boolean NOT NULL DEFAULT false,
  view_settings boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kommo.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Minha Conta',
  owner_id UUID NOT NULL,
  ai_analysis_enabled boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kommo.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

-- Integração Kommo: token NUNCA em claro — guardamos a referência do secret no
-- Supabase Vault (token_secret_id) + subdomain (não-secreto). (Wiring do Vault no M4.)
CREATE TABLE kommo.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'kommo',
  subdomain TEXT,
  token_secret_id UUID,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- helper: membership (SECURITY DEFINER para uso nas policies)
CREATE OR REPLACE FUNCTION kommo.is_workspace_member(_user_id UUID, _workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = kommo
AS $$
  SELECT EXISTS (
    SELECT 1 FROM kommo.workspace_members
    WHERE user_id = _user_id AND workspace_id = _workspace_id
  )
$$;

CREATE OR REPLACE FUNCTION kommo.has_role(_user_id UUID, _role kommo.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = kommo
AS $$
  SELECT EXISTS (SELECT 1 FROM kommo.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- permissões efetivas do usuário atual (admin = tudo true). Consumida pelo front
-- via supabase.rpc('get_my_permissions') com schema padrão `kommo`.
CREATE OR REPLACE FUNCTION kommo.get_my_permissions()
RETURNS TABLE (view_suggestions boolean, view_integrations boolean, view_settings boolean, is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = kommo
AS $$
DECLARE
  uid uuid := auth.uid();
  admin_flag boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN QUERY SELECT false, false, false, false; RETURN;
  END IF;
  admin_flag := kommo.has_role(uid, 'admin');
  IF admin_flag THEN
    RETURN QUERY SELECT true, true, true, true; RETURN;
  END IF;
  RETURN QUERY
    SELECT COALESCE(p.view_suggestions, false), COALESCE(p.view_integrations, false),
           COALESCE(p.view_settings, false), false
    FROM (SELECT 1) AS dummy
    LEFT JOIN kommo.user_permissions p ON p.user_id = uid;
END;
$$;

-- ----------------------------------------------------------------------------
-- Tabelas de dados do CRM (snapshot do Kommo)
-- ----------------------------------------------------------------------------

CREATE TABLE kommo.pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  kommo_id text NOT NULL,
  name text NOT NULL,
  sort integer,
  is_main boolean NOT NULL DEFAULT false,
  is_archive boolean NOT NULL DEFAULT false,
  statuses jsonb NOT NULL DEFAULT '[]'::jsonb,  -- etapas embutidas: [{id,name,sort,type,color}]
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kommo_id)
);

CREATE TABLE kommo.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  kommo_id text NOT NULL,
  name text NOT NULL,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kommo_id)
);

-- definição dos custom fields (leads e contacts). `code` é estável p/ predefinidos
-- (UTM_SOURCE, PHONE, EMAIL...). `enums` guarda opções de select/multiselect.
CREATE TABLE kommo.custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  kommo_id text NOT NULL,
  entity_type text NOT NULL,            -- 'leads' | 'contacts'
  name text NOT NULL,
  code text,
  field_type text,                       -- text | select | multiselect | date_time | tracking_data | multitext | ...
  enums jsonb,
  is_predefined boolean NOT NULL DEFAULT false,
  sort integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, entity_type, kommo_id)
);

CREATE TABLE kommo.loss_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  kommo_id text NOT NULL,
  name text NOT NULL,
  sort integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kommo_id)
);

CREATE TABLE kommo.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  kommo_id text NOT NULL,
  name text,
  phone text,                            -- extraído do custom field code=PHONE
  email text,                            -- extraído do custom field code=EMAIL
  responsible_user_id text,
  custom_fields jsonb DEFAULT '[]'::jsonb,
  kommo_created_at timestamptz,
  kommo_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kommo_id)
);

-- Entidade central do dashboard (= "lead" no Kommo, análogo a oportunidade no GHL)
CREATE TABLE kommo.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  kommo_id text NOT NULL,
  name text,
  pipeline_id text,
  status_id text,                        -- etapa atual (única por pipeline)
  status text,                           -- derivado no sync: 'open' | 'won' | 'lost'
  price numeric,                         -- valor monetário
  responsible_user_id text,              -- vendedor
  loss_reason_id text,
  source text,                           -- origem derivada (UTM/origem do lead)
  contact_id text,
  contact_name text,
  contact_phone text,
  contact_email text,
  custom_fields jsonb DEFAULT '{}'::jsonb,
  is_deleted boolean NOT NULL DEFAULT false,
  kommo_created_at timestamptz,
  kommo_updated_at timestamptz,
  closed_at timestamptz,
  last_status_change_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kommo_id)
);

CREATE INDEX idx_kommo_leads_workspace ON kommo.leads(workspace_id);
CREATE INDEX idx_kommo_leads_pipeline ON kommo.leads(workspace_id, pipeline_id);
CREATE INDEX idx_kommo_leads_status ON kommo.leads(workspace_id, status_id);
CREATE INDEX idx_kommo_leads_resp ON kommo.leads(workspace_id, responsible_user_id);
CREATE INDEX idx_kommo_leads_created ON kommo.leads(workspace_id, kommo_created_at DESC);
CREATE INDEX idx_kommo_leads_statuskind ON kommo.leads(workspace_id, status);
CREATE INDEX idx_kommo_contacts_workspace ON kommo.contacts(workspace_id);

-- Status do último sync e watermark incremental (por workspace)
CREATE TABLE kommo.sync_status (
  workspace_id uuid PRIMARY KEY REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_sync_duration_ms integer,
  leads_count integer DEFAULT 0,
  is_running boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kommo.sync_watermarks (
  workspace_id uuid PRIMARY KEY REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  leads_last_seen_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,
  last_run_error text,
  last_run_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Config do dashboard por workspace (mapeamento de funil, won, origem, UTMs).
-- Campos UTM podem apontar para o `code` (UTM_SOURCE) — mais estável que id.
CREATE TABLE kommo.dashboard_settings (
  workspace_id uuid PRIMARY KEY REFERENCES kommo.workspaces(id) ON DELETE CASCADE,
  default_pipeline_ids text[] DEFAULT '{}',
  visible_custom_fields text[] DEFAULT '{}',
  origin_field_name text,
  additional_date_field text,
  funnel_stage_mapping jsonb,
  won_stage_keys text[] DEFAULT '{142}',     -- Kommo: ganho = 142
  utm_source_field_id text DEFAULT 'UTM_SOURCE',
  utm_medium_field_id text DEFAULT 'UTM_MEDIUM',
  utm_campaign_field_id text DEFAULT 'UTM_CAMPAIGN',
  utm_content_field_id text DEFAULT 'UTM_CONTENT',
  utm_term_field_id text DEFAULT 'UTM_TERM',
  business_hours_start text,
  business_hours_end text,
  ai_allowed_pipeline_ids text[] DEFAULT '{}',
  ai_insights_config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Triggers updated_at
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_kommo_profiles_upd BEFORE UPDATE ON kommo.profiles FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_user_permissions_upd BEFORE UPDATE ON kommo.user_permissions FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_workspaces_upd BEFORE UPDATE ON kommo.workspaces FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_integrations_upd BEFORE UPDATE ON kommo.integrations FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_pipelines_upd BEFORE UPDATE ON kommo.pipelines FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_users_upd BEFORE UPDATE ON kommo.users FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_custom_fields_upd BEFORE UPDATE ON kommo.custom_fields FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_loss_reasons_upd BEFORE UPDATE ON kommo.loss_reasons FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_contacts_upd BEFORE UPDATE ON kommo.contacts FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_leads_upd BEFORE UPDATE ON kommo.leads FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_sync_status_upd BEFORE UPDATE ON kommo.sync_status FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_sync_watermarks_upd BEFORE UPDATE ON kommo.sync_watermarks FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();
CREATE TRIGGER trg_kommo_dashboard_settings_upd BEFORE UPDATE ON kommo.dashboard_settings FOR EACH ROW EXECUTE FUNCTION kommo.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE kommo.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.loss_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.sync_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE kommo.dashboard_settings ENABLE ROW LEVEL SECURITY;

-- profiles: dono
CREATE POLICY "own profile select" ON kommo.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own profile insert" ON kommo.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own profile update" ON kommo.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "svc profiles" ON kommo.profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_roles: dono lê; service role gere
CREATE POLICY "own roles select" ON kommo.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "svc user_roles" ON kommo.user_roles FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_permissions: dono lê; admin gere; service role tudo
CREATE POLICY "own perms select" ON kommo.user_permissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "admin perms select" ON kommo.user_permissions FOR SELECT USING (kommo.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin perms insert" ON kommo.user_permissions FOR INSERT WITH CHECK (kommo.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin perms update" ON kommo.user_permissions FOR UPDATE USING (kommo.has_role(auth.uid(), 'admin'));
CREATE POLICY "svc user_permissions" ON kommo.user_permissions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- workspaces: membros leem; dono gere
CREATE POLICY "ws members select" ON kommo.workspaces FOR SELECT USING (kommo.is_workspace_member(auth.uid(), id));
CREATE POLICY "ws create" ON kommo.workspaces FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "ws owner update" ON kommo.workspaces FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "ws owner delete" ON kommo.workspaces FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "svc workspaces" ON kommo.workspaces FOR ALL TO service_role USING (true) WITH CHECK (true);

-- workspace_members: membros leem; dono do ws gere
CREATE POLICY "wm members select" ON kommo.workspace_members FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "wm owner insert" ON kommo.workspace_members FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM kommo.workspaces WHERE id = workspace_id AND owner_id = auth.uid()));
CREATE POLICY "wm owner delete" ON kommo.workspace_members FOR DELETE USING (EXISTS (SELECT 1 FROM kommo.workspaces WHERE id = workspace_id AND owner_id = auth.uid()));
CREATE POLICY "svc workspace_members" ON kommo.workspace_members FOR ALL TO service_role USING (true) WITH CHECK (true);

-- integrations: dono
CREATE POLICY "intg own select" ON kommo.integrations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "intg own insert" ON kommo.integrations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "intg own update" ON kommo.integrations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "intg own delete" ON kommo.integrations FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "svc integrations" ON kommo.integrations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Tabelas de dados: membros do workspace leem; service role (edge) tudo
CREATE POLICY "members select" ON kommo.pipelines FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.pipelines FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "members select" ON kommo.users FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "members select" ON kommo.custom_fields FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.custom_fields FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "members select" ON kommo.loss_reasons FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.loss_reasons FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "members select" ON kommo.contacts FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.contacts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "members select" ON kommo.leads FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.leads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "members select" ON kommo.sync_status FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.sync_status FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "members select" ON kommo.sync_watermarks FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.sync_watermarks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- dashboard_settings: membros leem e fazem upsert/update
CREATE POLICY "members select" ON kommo.dashboard_settings FOR SELECT USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "members insert" ON kommo.dashboard_settings FOR INSERT WITH CHECK (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "members update" ON kommo.dashboard_settings FOR UPDATE USING (kommo.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "svc all" ON kommo.dashboard_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- GRANTs de tabela/função (RLS continua restringindo as linhas)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA kommo TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA kommo TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kommo TO authenticated, service_role, anon;
