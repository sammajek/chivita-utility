-- Office-hours staff: pattern copied from the Staff tab; maintenance alerts sent once per flag, only in office hours.
begin;
insert into public.staff (staff_id, surname, first_name, email, app_role, work_pattern, alerts)
values ('T-OFF1', 'Maint', 'Office', 'office1@test.local', 'engineer', 'office', '{maintenance,digest}');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'office1@test.local');
do $$
declare n int;
begin
  assert (select work_pattern = 'office' and alerts @> '{maintenance,digest}' from public.profiles where email = 'office1@test.local'), 'copied from staff';
  assert public.in_office_hours('2026-11-16 09:00+01'), 'Monday 09:00 is office hours';
  assert not public.in_office_hours('2026-11-16 18:00+01'), 'Monday 18:00 is not';
  assert not public.in_office_hours('2026-11-15 10:00+01'), 'Sunday is not';
  insert into public.flags (ref_key, kind, severity, area, title) values ('t-office-1', 'pm_overdue', 'warning', 'U1', 'Test PM overdue');
  if public.in_office_hours() then
    perform public.run_office_alerts();
    select count(*) into n from public.notifications where kind = 'maintenance' and recipient_id = '00000000-0000-0000-0000-0000000000f1';
    assert n = 1, format('one maintenance message, got %s', n);
    perform public.run_office_alerts();
    select count(*) into n from public.notifications where kind = 'maintenance' and recipient_id = '00000000-0000-0000-0000-0000000000f1';
    assert n = 1, 'not sent twice';
  else
    assert public.run_office_alerts() = 0, 'nothing outside office hours';
  end if;
  update public.staff set work_pattern = 'shift' where staff_id = 'T-OFF1';
  assert (select work_pattern = 'shift' from public.profiles where email = 'office1@test.local'), 'staff edit follows to profile';
end $$;
rollback;
