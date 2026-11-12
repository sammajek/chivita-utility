-- Downtime rework: machine-specific causes, no RCA for planned/external, CBM rules, availability split, draft RCA.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'dteng@test.local'), ('00000000-0000-0000-0000-0000000000f2', 'dtop@test.local');
update public.profiles set role = 'engineer', active = true where email = 'dteng@test.local';
update public.profiles set role = 'operator', active = true where email = 'dtop@test.local';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
select public.check_in('{U1}');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
do $$
declare c uuid := (select id from public.assets where code = 'CMP-05'); bh uuid := (select id from public.assets where code = 'BH-01');
        e public.downtime_events; sp record;
begin
  -- machine-specific cause: compressor cause accepted on a compressor, refused on a borehole
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status)
  values (c, 'day', 'Unplanned Breakdown', 'Process and Utility', 'High discharge temperature trip', '2026-09-01 09:00+01', '2026-09-01 15:00+01', 'Closed')
  returning * into e;
  assert e.rca_required, '6 h breakdown needs RCA';
  assert exists (select 1 from public.rcas r where r.downtime_id = e.id and r.status = 'Not Started'
                  and r.owner_id = '00000000-0000-0000-0000-0000000000f1'), 'draft RCA assigned to the engineer on duty';
  begin
    insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, status)
    values (bh, 'day', 'Unplanned Breakdown', 'Process and Utility', 'High discharge temperature trip', now(), 'Open');
    raise exception 'compressor cause on a borehole should fail';
  exception when sqlstate 'P0001' then null;
  end;
  -- planned 8 h overhaul planned for 6 h: no RCA; 6 h planned, 2 h overrun counts as loss
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, planned_hours, status)
  values (c, 'day', 'Planned Maintenance', 'Overhaul / Major Service', 'Major overhaul', '2026-09-03 07:00+01', '2026-09-03 15:00+01', 6, 'Closed')
  returning * into e;
  assert not e.rca_required, 'planned work never needs an automatic RCA';
  select * into sp from public.downtime_split(e);
  assert sp.planned_hours = 6 and sp.loss_hours = 2 and sp.external_hours = 0, format('split planned/overrun: %s', sp);
  -- external supply failure: no RCA, external hours only
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status)
  values (c, 'day', 'External Supply Failure', 'Power Supply', 'Public power (PHCN / grid) outage', '2026-09-04 07:00+01', '2026-09-04 13:00+01', 'Closed')
  returning * into e;
  select * into sp from public.downtime_split(e);
  assert not e.rca_required and sp.loss_hours = 0 and sp.external_hours = 6, 'external: separate, no RCA';
  -- CBM: immediate stop counts as loss; scheduled CBM is planned
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, immediate_stop, status)
  values (c, 'day', 'Condition-Based Maintenance (CBM)', 'Condition Monitoring Finding', 'High vibration trend', '2026-09-05 07:00+01', '2026-09-05 12:00+01', true, 'Closed')
  returning * into e;
  select * into sp from public.downtime_split(e);
  assert not e.rca_required and sp.loss_hours = 5, 'urgent CBM is a loss, no RCA on first occurrence';
  -- idle / standby is no longer a downtime type
  begin
    insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, status)
    values (c, 'day', 'Idle / Standby', 'Operational', 'Operator error', now(), 'Open');
    raise exception 'idle should be refused';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
rollback;
