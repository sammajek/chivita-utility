-- Admin temporary password: admin only, min length, hash stored (never plain), audited.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'tpadmin@test.local'), ('00000000-0000-0000-0000-0000000000e2', 'tpuser@test.local');
update public.profiles set role = 'admin', active = true where email = 'tpadmin@test.local';
update public.profiles set role = 'engineer', active = true where email = 'tpuser@test.local';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
do $$ begin
  begin perform public.admin_set_temp_password('00000000-0000-0000-0000-0000000000e2', 'Longenough1'); raise exception 'non-admin should fail';
  exception when sqlstate 'P0001' then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$ begin
  begin perform public.admin_set_temp_password('00000000-0000-0000-0000-0000000000e2', 'short'); raise exception 'short password should fail';
  exception when sqlstate 'P0001' then null; end;
  perform public.admin_set_temp_password('00000000-0000-0000-0000-0000000000e2', 'Temp-Pass-2026');
end $$;
reset role;
do $$ begin
  assert (select encrypted_password = extensions.crypt('Temp-Pass-2026', encrypted_password) from auth.users where email = 'tpuser@test.local'), 'bcrypt hash stored';
  assert exists (select 1 from public.audit_log where table_name = 'auth.users' and reason = 'Temporary password set by admin'), 'audited';
end $$;
rollback;
