-- Shift handover: checklist must be answered; one per shift written by anyone on it; team-mates check out
-- "covered" and can add notes; only someone on the next shift acknowledges; manager signs; flags.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'hoout@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'hoin@test.local'), ('00000000-0000-0000-0000-0000000000c3', 'homgr@test.local'),
  ('00000000-0000-0000-0000-0000000000c4', 'homate@test.local');
update public.profiles set role = 'engineer', active = true where email in ('hoout@test.local', 'hoin@test.local', 'homate@test.local');
update public.profiles set role = 'shift_manager', active = true where email = 'homgr@test.local';
create temp table t_h (id uuid);
grant all on t_h to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c4', true);
select public.check_in('{U2}');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
select public.check_in('{U1}');
do $$
declare items jsonb := (select value from public.app_settings where key = 'handover_checklist');
        ck jsonb := '{}'; i text; h uuid;
begin
  begin
    perform public.submit_handover('{"groups":{}}', null, 'x');
    raise exception 'unanswered checklist should fail';
  exception when sqlstate 'P0001' then null;
  end;
  for i in select * from jsonb_array_elements_text(items) loop ck := ck || jsonb_build_object(i, jsonb_build_object('answer', 'yes')); end loop;
  ck := jsonb_set(ck, array[items->>0], '{"answer":"no"}');
  begin
    perform public.submit_handover(jsonb_build_object('checklist', ck), null, 'x');
    raise exception '"no" without a note should fail';
  exception when sqlstate 'P0001' then null;
  end;
  ck := jsonb_set(ck, array[items->>0], '{"answer":"no","note":"Boiler 2 09:00 missed, logged late"}');
  h := public.submit_handover(jsonb_build_object('checklist', ck, 'groups', '{"Compressors":{"running":"CMP-03, CMP-04"}}'::jsonb), 'All OK', 'Summary');
  insert into t_h values (h);
  assert (select checked_out_at from public.duty_sessions where profile_id = auth.uid()) is not null, 'checked out';
  assert (select areas = '{U1,U2}' and cardinality(on_duty) = 2 from public.handovers where id = h), 'covers the whole team and both areas';
  begin
    perform public.receive_handover(h, null);
    raise exception 'the same shift cannot acknowledge';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
-- the team-mate cannot write a second one, but can add a note and check out covered
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c4', true);
do $$
begin
  begin
    perform public.submit_handover('{}', null, 'x');
    raise exception 'second handover for the shift should fail';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.add_handover_note((select id from t_h), 'Dryer 7 alarm reset at 18:40, watch it');
  perform public.check_out_covered();
  assert (select checked_out_at from public.duty_sessions where profile_id = auth.uid()) is not null, 'team-mate checked out';
end $$;
-- the incoming engineer is on the next shift
reset role;
insert into public.duty_sessions (profile_id, shift_date, shift, areas)
select '00000000-0000-0000-0000-0000000000c2', n.shift_date, n.shift, '{U1}'
  from public.handovers h, public.next_shift_of(h.shift_date, h.shift) n where h.id = (select id from t_h);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
select public.receive_handover((select id from t_h), 'Read and understood');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
select public.sign_handover((select id from t_h), null);
do $$
begin
  assert (select received_at is not null and manager_at is not null from public.handovers where id = (select id from t_h)), 'received and signed';
  assert (select count(*) from public.handover_notes where handover_id = (select id from t_h)) = 2, 'note + acknowledgement recorded';
end $$;
reset role;
do $$
begin
  -- a shift three... days back with someone on duty and no handover is flagged
  insert into public.duty_sessions (profile_id, shift_date, shift, areas, checked_out_at)
  values ('00000000-0000-0000-0000-0000000000c2', public.log_date_of(now()) - 2, 'day', '{U1}', now() - interval '2 days');
  update public.handovers set received_at = null where id = (select id from t_h);
  assert public.run_handover_flags() >= 1, 'missing handover flagged';
  assert exists (select 1 from public.flags where kind = 'handover_missing'), 'handover_missing flag';
end $$;
rollback;
