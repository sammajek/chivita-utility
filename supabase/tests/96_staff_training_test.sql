-- Staff directory, pre-approved sign-up, training tick-off and flags.
begin;
do $$
begin
  assert (select count(*) from public.staff) = 15, '15 staff loaded';
  assert (select count(*) from public.training_courses) = 11, '11 courses';
  assert (select count(*) from public.training_plans) = 15, '15 training plans';
  assert (select planned_start from public.training_plans t join public.staff s on s.id = t.staff_ref where s.staff_id = '11100260') = '2026-11-30', 'cross-month dates parsed';
end $$;

-- admin pre-registers an email + role → sign-up is active with that role and linked
update public.staff set email = 'Rasheed.A@Test.Local ', app_role = 'operator', area = 'U1' where staff_id = '11102687';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'rasheed.a@test.local'),
                                          ('00000000-0000-0000-0000-0000000000b2', 'stranger@test.local'),
                                          ('00000000-0000-0000-0000-0000000000b3', 'trneng@test.local');
update public.profiles set role = 'engineer', active = true where email = 'trneng@test.local';
do $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = '00000000-0000-0000-0000-0000000000b1';
  assert p.active and p.role = 'operator' and p.staff_id = '11102687' and p.full_name = 'Rasheed Adeniji', 'pre-approved sign-up';
  assert p.areas = '{U1}', 'area from staff record';
  assert (select profile_id from public.staff where staff_id = '11102687') = p.id, 'linked';
  select * into p from public.profiles where id = '00000000-0000-0000-0000-0000000000b2';
  assert not p.active and p.role = 'viewer', 'unknown email stays inactive';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare t uuid := (select id from public.training_plans limit 1);
begin
  begin
    perform public.set_training_status(t, 'completed', public.lagos_now()::date, null);
    raise exception 'operator cannot tick training';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
do $$
declare t uuid := (select id from public.training_plans order by planned_start limit 1);
begin
  begin
    perform public.set_training_status(t, 'postponed', null, null);
    raise exception 'postponed needs a note';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.set_training_status(t, 'completed', public.lagos_now()::date, 'Certificate received');
  assert (select status from public.training_plans where id = t) = 'completed', 'ticked';
  assert (select confirmed_by from public.training_plans where id = t) = auth.uid(), 'who ticked';
  assert (select recorded_by_type from public.training_plans where id = t) = 'logger', 'import stamp kept';
end $$;

reset role;
do $$
begin
  update public.training_plans set planned_start = public.lagos_now()::date - 10, planned_end = public.lagos_now()::date - 5
   where status = 'planned';
  assert public.run_training_flags() = 14, 'past, unticked training flagged';
end $$;
rollback;
