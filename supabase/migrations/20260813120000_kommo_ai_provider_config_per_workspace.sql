-- ============================================================================
-- Chave de IA passa a ser POR WORKSPACE, não por usuário.
--
-- Motivo: com chave por user_id, num workspace com vários membros a análise
-- de IA usava "a chave de quem for owner, senão a de quem estiver logado" —
-- ambíguo, e nada impedia dois membros com chaves diferentes gerando custo em
-- contas OpenAI distintas sem previsibilidade. Cada workspace agora tem UMA
-- chave, cadastrada por qualquer membro, compartilhada/visível para todos os
-- membros (mesmo padrão de kommo.dashboard_settings). Sem fallback para
-- nenhuma chave central/global — a edge kommo-ai-analyze SÓ funciona se o
-- workspace tiver a própria chave configurada.
--
-- Migração de dados: para workspaces que já tinham config por usuário, herda
-- a chave do OWNER do workspace (mesma prioridade que a edge já usava antes).
-- ============================================================================

alter table kommo.ai_provider_config add column workspace_id uuid references kommo.workspaces(id) on delete cascade;

-- Backfill: 1 linha por workspace, priorizando a chave do owner; se o owner
-- nunca configurou, usa a de qualquer membro que tenha.
with picked as (
  select distinct on (w.id)
    w.id as workspace_id,
    c.id as config_id
  from kommo.workspaces w
  join kommo.workspace_members m on m.workspace_id = w.id
  join kommo.ai_provider_config c on c.user_id = m.user_id
  order by w.id, (m.user_id = w.owner_id) desc, c.updated_at desc
)
update kommo.ai_provider_config c
set workspace_id = p.workspace_id
from picked p
where c.id = p.config_id;

-- Configs que sobraram sem workspace_id (usuário não é membro de nenhum
-- workspace, ou perdeu a corrida do DISTINCT ON acima) não servem mais —
-- a edge só lê por workspace_id daqui pra frente.
delete from kommo.ai_provider_config where workspace_id is null;

alter table kommo.ai_provider_config drop constraint ai_provider_config_user_id_key;
alter table kommo.ai_provider_config alter column workspace_id set not null;
alter table kommo.ai_provider_config add constraint ai_provider_config_workspace_id_key unique (workspace_id);
alter table kommo.ai_provider_config alter column user_id drop not null;

drop policy if exists "own select" on kommo.ai_provider_config;
drop policy if exists "own insert" on kommo.ai_provider_config;
drop policy if exists "own update" on kommo.ai_provider_config;

create policy "members select" on kommo.ai_provider_config
  for select using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "members insert" on kommo.ai_provider_config
  for insert with check (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "members update" on kommo.ai_provider_config
  for update using (kommo.is_workspace_member(auth.uid(), workspace_id));
create policy "members delete" on kommo.ai_provider_config
  for delete using (kommo.is_workspace_member(auth.uid(), workspace_id));
