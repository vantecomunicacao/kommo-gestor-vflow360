-- ============================================================================
-- M4 — Funções de workspace/membros no schema `kommo`.
-- A fundação (20260617120000) criou as TABELAS kommo.workspaces/workspace_members
-- e os helpers is_workspace_member/has_role/get_my_permissions, mas NÃO as RPCs de
-- gestão. O app (client schema `kommo`) chama create_workspace / list_workspace_members
-- / add_workspace_member / remove_workspace_member via .rpc(), que resolviam em
-- kommo.* inexistente → quebrado. Espelha as versões de public, mas grava em kommo.*.
-- Additive: schema kommo apenas; não toca em public/GHL.
-- ============================================================================

-- Caller é dono do workspace OU admin global.
create or replace function kommo.can_manage_workspace(_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = kommo, public
as $$
  select exists (
           select 1 from kommo.workspaces
           where id = _workspace_id and owner_id = auth.uid()
         )
      or kommo.has_role(auth.uid(), 'admin');
$$;

-- Cria um workspace (apenas admin global) + vincula o criador como owner.
create or replace function kommo.create_workspace(_name text)
returns uuid
language plpgsql security definer set search_path = kommo, public
as $$
declare
  _workspace_id uuid;
  _user_id uuid := auth.uid();
begin
  if _user_id is null then
    raise exception 'Not authenticated';
  end if;
  if not kommo.has_role(_user_id, 'admin') then
    raise exception 'Only admins can create workspaces';
  end if;

  insert into kommo.workspaces (name, owner_id)
  values (_name, _user_id)
  returning id into _workspace_id;

  insert into kommo.workspace_members (workspace_id, user_id, role)
  values (_workspace_id, _user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return _workspace_id;
end;
$$;

-- Lista membros de um workspace (qualquer membro ou admin pode ver).
create or replace function kommo.list_workspace_members(_workspace_id uuid)
returns table (user_id uuid, email text, full_name text, role text, is_owner boolean)
language plpgsql stable security definer set search_path = kommo, public
as $$
begin
  if not (kommo.is_workspace_member(auth.uid(), _workspace_id) or kommo.has_role(auth.uid(), 'admin')) then
    raise exception 'Acesso negado';
  end if;
  return query
    select wm.user_id,
           u.email::text,
           p.full_name,
           wm.role,
           (w.owner_id = wm.user_id) as is_owner
    from kommo.workspace_members wm
    join kommo.workspaces w on w.id = wm.workspace_id
    left join auth.users u on u.id = wm.user_id
    left join kommo.profiles p on p.user_id = wm.user_id
    where wm.workspace_id = _workspace_id
    order by (w.owner_id = wm.user_id) desc, p.full_name nulls last;
end;
$$;

-- Adiciona um usuário EXISTENTE (por e-mail) ao workspace.
create or replace function kommo.add_workspace_member(_workspace_id uuid, _email text)
returns text
language plpgsql security definer set search_path = kommo, public
as $$
declare
  _uid uuid;
begin
  if not kommo.can_manage_workspace(_workspace_id) then
    raise exception 'Apenas o dono do workspace pode adicionar membros';
  end if;

  select id into _uid from auth.users
  where lower(email) = lower(btrim(_email))
  limit 1;

  if _uid is null then
    raise exception 'Nenhum usuário com esse e-mail. A pessoa precisa ter conta no sistema.';
  end if;

  insert into kommo.workspace_members (workspace_id, user_id, role)
  values (_workspace_id, _uid, 'member')
  on conflict (workspace_id, user_id) do nothing;

  return _uid::text;
end;
$$;

-- Remove um membro (não permite remover o dono).
create or replace function kommo.remove_workspace_member(_workspace_id uuid, _user_id uuid)
returns void
language plpgsql security definer set search_path = kommo, public
as $$
begin
  if not kommo.can_manage_workspace(_workspace_id) then
    raise exception 'Apenas o dono do workspace pode remover membros';
  end if;
  if exists (select 1 from kommo.workspaces where id = _workspace_id and owner_id = _user_id) then
    raise exception 'Não é possível remover o dono do workspace';
  end if;
  delete from kommo.workspace_members
  where workspace_id = _workspace_id and user_id = _user_id;
end;
$$;

-- Trava de acesso: só usuário autenticado (a checagem fina é dentro de cada função).
revoke all on function kommo.can_manage_workspace(uuid) from public, anon;
revoke all on function kommo.create_workspace(text) from public, anon;
revoke all on function kommo.list_workspace_members(uuid) from public, anon;
revoke all on function kommo.add_workspace_member(uuid, text) from public, anon;
revoke all on function kommo.remove_workspace_member(uuid, uuid) from public, anon;
grant execute on function kommo.can_manage_workspace(uuid) to authenticated;
grant execute on function kommo.create_workspace(text) to authenticated;
grant execute on function kommo.list_workspace_members(uuid) to authenticated;
grant execute on function kommo.add_workspace_member(uuid, text) to authenticated;
grant execute on function kommo.remove_workspace_member(uuid, uuid) to authenticated;
