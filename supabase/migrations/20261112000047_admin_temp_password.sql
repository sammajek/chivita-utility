-- An admin can give someone a temporary password (forgotten password, no email yet). Only the bcrypt hash is stored,
-- exactly as Supabase Auth stores it; the action is written to the audit log (who, for whom, when — never the password).
create or replace function public.admin_set_temp_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare who text;
begin
  if not public.has_role('admin') then raise exception 'Only an admin can set a temporary password.' using errcode = 'P0001'; end if;
  if coalesce(length(p_password), 0) < 8 then raise exception 'Use at least 8 characters.' using errcode = 'P0001'; end if;
  select email into who from auth.users where id = p_user;
  if who is null then raise exception 'User not found.' using errcode = 'P0001'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  insert into public.audit_log (table_name, record_id, action, changed_by, reason, new_data)
  values ('auth.users', p_user::text, 'update', auth.uid(), 'Temporary password set by admin', jsonb_build_object('email', who));
end;
$$;
revoke execute on function public.admin_set_temp_password(uuid, text) from public, anon;
grant execute on function public.admin_set_temp_password(uuid, text) to authenticated;
