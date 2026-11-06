-- Patrols: visit needs the current code and all checks answered; issues need a note and raise a flag; missed rounds flagged.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d7', 'patmgr@test.local'),
                                          ('00000000-0000-0000-0000-0000000000d8', 'patop@test.local');
update public.profiles set role = 'section_manager', active = true where email = 'patmgr@test.local';
update public.profiles set role = 'operator', active = true where email = 'patop@test.local';
create temp table t_p (k text, pt uuid);
grant all on t_p to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d7', true);
insert into public.patrol_points (name, area, checks) values ('Borehole field', 'U1', '{"No leaks","Area secure"}');
insert into t_p select public.issue_patrol_code(id), id from public.patrol_points where name = 'Borehole field';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d8', true);
do $$
declare k text := (select k from t_p); pt uuid := (select pt from t_p);
begin
  begin perform public.record_patrol_visit(pt, 'wrong', '{"No leaks":"ok","Area secure":"ok"}', null); raise exception 'bad code should fail';
  exception when sqlstate 'P0001' then null; end;
  begin perform public.record_patrol_visit(pt, k, '{"No leaks":"ok"}', null); raise exception 'unanswered check should fail';
  exception when sqlstate 'P0001' then null; end;
  begin perform public.record_patrol_visit(pt, k, '{"No leaks":"issue","Area secure":"ok"}', null); raise exception 'issue without note should fail';
  exception when sqlstate 'P0001' then null; end;
  perform public.record_patrol_visit(pt, k, '{"No leaks":"issue","Area secure":"ok"}', 'Pipe flange weeping at BH-04');
  assert (select issues from public.patrol_visits) = 1 and (select recorded_by_id from public.patrol_visits) = auth.uid(), 'visit tagged';
  assert exists (select 1 from public.flags where kind = 'patrol_issue'), 'issue flagged';
end $$;
reset role;
do $$
begin
  -- pretend the code existed three days ago: earlier finished shifts without visits are flagged
  update public.patrol_points set code_issued_at = now() - interval '3 days';
  assert public.run_patrol_flags() >= 3, 'missed rounds flagged';
end $$;
rollback;
