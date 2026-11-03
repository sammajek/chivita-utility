-- Scheduled decks: one in-app + one e-mail message per recipient per scheduled hour, link only.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'deckmgr@test.local');
update public.profiles set role = 'section_manager', active = true where email = 'deckmgr@test.local';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
insert into public.deck_templates (name, sections, period, schedule, schedule_dow, schedule_hour, recipients)
values ('Monday review', '{summary,downtime}', 'last_week', 'weekly',
        extract(isodow from public.lagos_now())::int, extract(hour from public.lagos_now())::int,
        array['00000000-0000-0000-0000-0000000000f1'::uuid]);
reset role;
do $$
begin
  assert public.run_deck_schedules() = 1, 'due schedule sent';
  assert public.run_deck_schedules() = 0, 'not sent twice in the same hour';
  assert (select count(*) from public.notifications where kind = 'report') = 2, 'in-app + e-mail';
  assert (select bool_and(link like '/reports/deck?saved=%') from public.notifications where kind = 'report'), 'link to build on open';
end $$;
rollback;
