-- Reorganiza as flags de permissao de kommo.user_permissions: 3 -> 4 flags
-- simetricas e independentes, sem logica de combinacao escondida (isSuggestionsOnly).
--   view_suggestions -> renomeada para view_cooling (controla /leads-esfriando)
--   view_dashboard    -> NOVA (controla /dashboard, /relatorios, /anotacoes)
--   view_integrations -> mantem nome
--   view_settings      -> mantem nome
-- Admin global (kommo.has_role(uid,'admin')) continua liberando as 4 automaticamente.
-- Ver CLAUDE.md / conversa 2026-08-17 sobre reorganizacao das permissoes.

alter table kommo.user_permissions
  rename column view_suggestions to view_cooling;

alter table kommo.user_permissions
  add column view_dashboard boolean not null default true;

-- Migracao de dados: quem hoje e "so sugestoes" pura (view_cooling=true e as
-- outras duas false, nao-admin) NAO tinha acesso a Dashboard/Relatorios (bloqueado
-- pelo GestorGuard/isSuggestionsOnly) -- perde o default true. Todo o resto
-- (inclusive quem tinha as 3 flags false) ja acessava Dashboard/Relatorios
-- livremente hoje, entao mantem o default true que a coluna nasceu com.
update kommo.user_permissions
set view_dashboard = false
where view_cooling = true
  and view_integrations = false
  and view_settings = false;

-- RPC: 4 flags + is_admin (5 colunas no RETURN QUERY SELECT). O shape do
-- RETURNS TABLE mudou (3->5 colunas), Postgres nao aceita CREATE OR REPLACE
-- quando os OUT parameters mudam de estrutura -- precisa dropar antes.
drop function if exists kommo.get_my_permissions();

create function kommo.get_my_permissions()
returns table (
  view_cooling boolean,
  view_dashboard boolean,
  view_integrations boolean,
  view_settings boolean,
  is_admin boolean
)
language plpgsql
stable
security definer
set search_path = kommo
as $$
declare
  uid uuid := auth.uid();
  admin_flag boolean;
begin
  if uid is null then
    return query select false, false, false, false, false;
    return;
  end if;
  admin_flag := kommo.has_role(uid, 'admin');
  if admin_flag then
    return query select true, true, true, true, true;
    return;
  end if;
  return query
    select
      coalesce(p.view_cooling, false),
      coalesce(p.view_dashboard, false),
      coalesce(p.view_integrations, false),
      coalesce(p.view_settings, false),
      false
    from (select 1) as dummy
    left join kommo.user_permissions p on p.user_id = uid;
end;
$$;
