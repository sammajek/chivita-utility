-- Structured handover: checklist must be answered, submitting checks out, incoming receives, manager signs.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'hoout@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'hoin@test.local'), ('00000000-0000-0000-0000-0000000000c3', 'homgr@test.local');
update public.profiles set role = 'engineer', active = true where email in ('hoout@test.local', 'hoin@test.local');
update public.profiles set role = 'shift_manager', active = true where email = 'homgr@test.local';
create temp table t_h (id uuid);
grant all on t_h to authenticated;
set local role authenticated;
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
  begin
    perform public.receive_handover(h, null);
    raise exception 'own handover cannot be received by self';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
select public.receive_handover((select id from t_h), 'Read and understood');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
select public.sign_handover((select id from t_h), null);
do $$
begin
  assert (select received_at is not null and manager_at is not null from public.handovers where id = (select id from t_h)), 'received and signed';
end $$;
rollback;
