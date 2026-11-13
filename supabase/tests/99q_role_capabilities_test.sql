-- Access rights: defaults match the old fixed rules; switching a group off for engineers takes effect in has_role().
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'capeng@test.local'),
                                          ('00000000-0000-0000-0000-0000000000e2', 'capadmin@test.local');
update public.profiles set role = 'engineer', active = true where email = 'capeng@test.local';
update public.profiles set role = 'admin', active = true where email = 'capadmin@test.local';
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
  assert public.is_engineer_or_above(), 'engineer tier by default';
  assert public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin'), 'enter records';
  assert not public.is_manager_or_admin(), 'not shift manager tier';
  assert not public.has_role('admin', 'section_manager'), 'not manager tier';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
  perform public.set_role_capability('engineer', 'engineer_tasks', false);
  perform public.set_role_capability('engineer', 'manager_tasks', true);
  begin
    perform public.set_role_capability('admin', 'admin_tasks', false);
    assert false, 'admin lock-out must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
  assert not public.is_engineer_or_above(), 'engineer tasks switched off';
  assert public.has_role('section_manager', 'admin'), 'manager tasks given';
  assert 'manager_tasks' = any (public.my_capabilities()), 'my_capabilities';
end $$;
rollback;
