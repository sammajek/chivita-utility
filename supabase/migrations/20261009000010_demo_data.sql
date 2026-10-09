-- DEMO data generator, so every screen can be reviewed before real data exists.
-- Everything it creates is marked is_demo = true and can be removed with
-- clear_demo_data(). Only admins (or the database owner) can run either.

create or replace function public.demo_value(p public.parameters, slot_no int)
-- slot_no = hours since 1 Jan 2026 at the slot time
returns table (v_num numeric, v_text text, bad boolean)
language plpgsql
volatile
set search_path = public
as $$
declare
  r      double precision := random();
  lo     numeric;
  hi     numeric;
  base   numeric;
begin
  bad := false;
  if p.data_type = 'select' then
    if p.ok_options is not null and r < 0.03 then
      v_text := (select o from unnest(p.options) o where not (o = any (p.ok_options)) limit 1);
      bad := v_text is not null;
    end if;
    v_text := coalesce(v_text, p.ok_options[1], p.options[1 + (slot_no % cardinality(p.options))]);
    return next; return;
  end if;
  if p.is_counter then
    -- cumulative counters (running hours etc.): ~95% utilisation since 1 Jan 2026
    v_num := round((5000 + slot_no * 0.95)::numeric, 1);
    return next; return;
  end if;
  lo := p.std_min; hi := p.std_max;
  if lo is not null and hi is not null and hi > lo then
    base := lo + (hi - lo) * (0.15 + 0.7 * random());
    if r < 0.04 then base := hi + (hi - lo) * (0.1 + random() * 0.4); bad := true; end if;
  elsif lo is not null and hi is not null then
    base := lo;
  elsif lo is not null then
    base := greatest(lo, 0.1) * (1.05 + random() * 0.25);
    if r < 0.04 then base := lo * 0.8; bad := lo > 0; end if;
  elsif hi is not null then
    base := hi * (0.5 + random() * 0.35);
    if r < 0.04 then base := hi * 1.15 + 0.01; bad := true; end if;
  else
    base := case coalesce(p.unit, '')
      when '°C' then 25 + random() * 20 when 'bar' then 2 + random() * 5 when '%' then 50 + random() * 40
      when 'kPa' then 300 + random() * 600 when 'm³/h' then 20 + random() * 30 when 'mbar' then 20 + random() * 30
      when 'ppm' then 50 + random() * 200 when 'µS/cm' then 300 + random() * 900 when 'kW' then 120 + random() * 60
      when 'Hz' then 45 + random() * 5 when 'TR' then 300 + random() * 150 when 'mmHg' then 4 + random() * 4
      else 5 + random() * 5 end;
  end if;
  v_num := round(base, 2);
  return next;
end;
$$;

create or replace function public.generate_demo_data(p_days int, p_operator uuid, p_engineer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reg_keys text[] := array['u1-boiler', 'u1-compressor-oilfree', 'u1-dryer-ir', 'u1-trane', 'u1-wtp', 'u1-gu-shift'];
  n_read int := 0; n_dt int := 0;
  d date;
  i int;
  a record;
  fm record;
  st timestamptz;
  hrs numeric;
  v_caller text := current_setting('request.jwt.claim.sub', true);
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can generate demo data.' using errcode = 'P0001';
  end if;
  if p_days < 1 or p_days > 120 then
    raise exception 'Choose between 1 and 120 days.' using errcode = 'P0001';
  end if;

  -- Readings: bypass row triggers for bulk speed; status and identity are computed here instead.
  alter table public.readings disable trigger user;
  with slots as (
    select rs.register_id, rs.section_id, rs.slot_key, rs.due_at, dd::date as log_date
      from generate_series(public.log_date_of(now()) - p_days, public.log_date_of(now()) - 1, interval '1 day') dd,
           lateral public.register_slots(dd::date) rs
      join public.registers r on r.id = rs.register_id
     where r.key = any (reg_keys)
  ), targets as (
    select sl.*, f.id as field_id, f.parameter_id, coalesce(f.asset_id, ra.asset_id) as asset_id
      from slots sl
      join public.register_fields f on f.section_id = sl.section_id and f.active
      left join public.register_assets ra on ra.register_id = sl.register_id and f.asset_id is null
     where coalesce(f.asset_id, ra.asset_id) is not null
  ), vals as (
    select t.*, p, dv.*
      from targets t
      join public.parameters p on p.id = t.parameter_id
      cross join lateral public.demo_value(p, floor(extract(epoch from t.due_at - timestamptz '2026-01-01') / 3600)::int) dv
  ), ins as (
    insert into public.readings (register_id, field_id, asset_id, parameter_id, log_date, slot_key, reading_for,
                                 value_num, value_text, status, comment, minutes_late,
                                 recorded_by_type, recorded_by_id, recorded_at, is_demo)
    select v.register_id, v.field_id, v.asset_id, v.parameter_id, v.log_date, v.slot_key, v.due_at,
           v.v_num, v.v_text, public.evaluate_value(v.p, v.v_num, v.v_text),
           case when public.evaluate_value(v.p, v.v_num, v.v_text) in ('out_of_spec', 'critical')
                then 'DEMO: value outside standard, engineer informed' end,
           lat.m, 'person', p_operator, v.due_at + make_interval(mins => lat.m), true
      from vals v
      cross join lateral (select case when random() < 0.9 then floor(random() * 20)::int
                                      else 30 + floor(random() * 90)::int end as m) lat
     -- leave ~2% of slots empty so missed readings show up in compliance
     where random() > 0.02
    on conflict do nothing
    returning 1
  ) select count(*) into n_read from ins;
  alter table public.readings enable trigger user;

  -- Downtime events and RCAs go through the normal triggers (RCA rule etc.).
  perform set_config('request.jwt.claim.sub', p_operator::text, true);
  for i in 1 .. greatest(6, p_days / 3) loop
    select id, area into a from public.assets
     where code in ('BLR-01', 'BLR-02', 'BLR-05', 'CMP-03', 'CMP-05', 'CMP-07', 'DRY-06', 'CHT-01', 'CHT-02', 'PMP-RW', 'UV-02')
     order by random() limit 1;
    select value as mode, parent as cat into fm from public.lists
     where list_name = 'failure_mode' and parent not in ('Planned Maintenance') order by random() limit 1;
    st := now() - make_interval(days => 1 + floor(random() * (p_days - 1))::int, hours => floor(random() * 24)::int);
    hrs := case when random() < 0.25 then 4 + random() * 10 else 0.3 + random() * 3 end;
    insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, issue_description,
                                        start_at, end_at, immediate_action, attended_by, production_impact, status, remarks, is_demo)
    values (a.id, case when extract(hour from st at time zone 'Africa/Lagos') between 7 and 18 then 'day' else 'night' end,
            'Unplanned Breakdown', fm.cat, fm.mode,
            (select value from public.lists where list_name = 'issue_description' order by random() limit 1),
            st, st + make_interval(secs => (hrs * 3600)::int), 'DEMO: fault rectified and equipment restarted',
            (select value from public.lists where list_name = 'attended_by' order by random() limit 1),
            (select value from public.lists where list_name = 'production_impact' order by random() limit 1),
            'Closed', 'DEMO record', true);
    n_dt := n_dt + 1;
  end loop;
  -- one planned maintenance and one still-open event
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status, remarks, is_demo)
  values ((select id from public.assets where code = 'CMP-04'), 'day', 'Planned Maintenance', 'Planned Maintenance',
          'Planned preventive maintenance', now() - interval '5 days', now() - interval '5 days' + interval '6 hours', 'Closed', 'DEMO record', true),
         ((select id from public.assets where code = 'CHT-04'), 'day', 'Unplanned Breakdown', 'Maintenance and Spares',
          'Spare parts unavailable', now() - interval '30 hours', null, 'Awaiting Spares', 'DEMO record', true);
  n_dt := n_dt + 2;

  perform set_config('request.jwt.claim.sub', p_engineer::text, true);
  insert into public.rcas (downtime_id, asset_id, problem, why1, why2, why3, root_cause, category_6m, corrective_action,
                           preventive_action, action_type, cost_ngn, owner_id, target_date, status, is_demo)
  select e.id, e.asset_id, 'DEMO: ' || e.failure_mode || ' on ' || (select code from public.assets where id = e.asset_id),
         'Equipment stopped', 'Component failed', 'Inspection interval too long', 'PM interval not matched to duty',
         'Machine (equipment / design)', 'Component replaced', 'PM task frequency revised',
         'Preventive Maintenance Revision', 150000, p_engineer,
         (now() at time zone 'Africa/Lagos')::date + (case when random() < 0.5 then -3 else 10 end),
         'Action In Progress', true
    from public.downtime_events e where e.is_demo and e.rca_required
   order by e.start_at desc limit 3;

  -- yesterday's duty sessions
  insert into public.duty_sessions (profile_id, shift_date, shift, areas, checked_in_at, checked_out_at, handover_note, open_flags_at_checkout, is_demo)
  values (p_engineer, public.log_date_of(now()) - 1, 'day', '{U1,U2}',
          public.lagos_ts(public.log_date_of(now()) - 1, '06:52'), public.lagos_ts(public.log_date_of(now()) - 1, '19:08'),
          'DEMO: Boiler 2 flame signal low at 15:00, burner cleaned. Compressor 5 running hot, monitor.', 2, true)
  on conflict do nothing;

  -- restore the caller's identity
  perform set_config('request.jwt.claim.sub', coalesce(v_caller, ''), true);
  perform public.run_flag_job();
  return jsonb_build_object('readings', n_read, 'downtime_events', n_dt);
end;
$$;

create or replace function public.clear_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can clear demo data.' using errcode = 'P0001';
  end if;
  alter table public.readings disable trigger user;
  alter table public.downtime_events disable trigger user;
  alter table public.rcas disable trigger user;
  delete from public.flags where is_demo or reading_id in (select id from public.readings where is_demo)
                              or downtime_id in (select id from public.downtime_events where is_demo)
                              or rca_id in (select id from public.rcas where is_demo);
  delete from public.rcas where is_demo;
  delete from public.readings where is_demo;
  delete from public.downtime_events where is_demo;
  delete from public.duty_sessions where is_demo;
  alter table public.readings enable trigger user;
  alter table public.downtime_events enable trigger user;
  alter table public.rcas enable trigger user;
end;
$$;

revoke execute on function public.demo_value(public.parameters, int) from public, anon, authenticated;
revoke execute on function public.generate_demo_data(int, uuid, uuid) from public, anon;
revoke execute on function public.clear_demo_data() from public, anon;
