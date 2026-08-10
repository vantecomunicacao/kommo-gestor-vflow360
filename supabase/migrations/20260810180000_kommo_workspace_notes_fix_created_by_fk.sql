-- Fix: created_by apontava para kommo.profiles(id), mas kommo.profiles.id é um
-- uuid próprio (não igual a auth.users.id — a FK para o usuário logado ali é
-- via profiles.user_id). O frontend grava auth.users.id (o real user.id da
-- sessão), então todo insert violava a constraint. Mesmo padrão de
-- kommo.dashboard_analyses.user_id: coluna solta, sem FK, comentada.
alter table kommo.workspace_notes drop constraint workspace_notes_created_by_fkey;
comment on column kommo.workspace_notes.created_by is 'auth.users.id de quem criou (sem FK, mesmo padrão de dashboard_analyses.user_id)';
