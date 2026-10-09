-- Let the demo generator insert rows through the normal triggers (no trigger
-- switching): rows marked is_demo keep the recorded_at / recorded_by the
-- generator gives them, are not written to the audit log, and can be deleted.
-- Signed-in users can never create is_demo rows (RLS), so this cannot be used
-- to back-date real records.

create or replace function public.stamp_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((to_jsonb(new) ->> 'is_demo')::boolean, false) then
    return new;  -- demo generator sets its own stamps (RLS stops users creating demo rows)
  end if;
  new.recorded_at := now();
  if new.recorded_by_type = 'person' then
    if auth.uid() is null then
      raise exception 'A person-tagged record needs a logged-in user.' using errcode = 'P0001';
    end if;
    new.recorded_by_id := auth.uid();
  elsif new.recorded_by_type = 'logger' then
    if new.recorded_by_id is null then
      raise exception 'A logger-tagged record needs recorded_by_id.' using errcode = 'P0001';
    end if;
  else
    raise exception 'recorded_by_type must be person or logger.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_recorded() from public, anon, authenticated;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_j   jsonb;
  new_j   jsonb;
  fields  text[];
  reason  text := nullif(current_setting('app.change_reason', true), '');
  require_reason boolean := coalesce(tg_argv[0]::boolean, true);
  act     text;
begin
  if tg_op = 'DELETE' then
    if coalesce((to_jsonb(old) ->> 'is_demo')::boolean, false) then
      return old;  -- demo rows may be removed
    end if;
    raise exception 'Records in % cannot be deleted. Void the record with a reason instead.', tg_table_name
      using errcode = 'P0001';
  end if;

  new_j := to_jsonb(new);
  if coalesce((new_j ->> 'is_demo')::boolean, false) then
    return new;  -- demo rows are not audited
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (table_name, record_id, action, changed_by, new_data)
    values (tg_table_name, new.id::text, 'insert', auth.uid(), new_j);
    return new;
  end if;

  old_j := to_jsonb(old);

  select array_agg(key order by key) into fields
  from jsonb_each(new_j) n
  where n.value is distinct from old_j -> n.key
    and n.key not in ('updated_at');

  if fields is null then
    return new;
  end if;

  if new_j ? 'voided_at' and (old_j ->> 'voided_at') is null and (new_j ->> 'voided_at') is not null then
    act := 'void';
    reason := coalesce(reason, new_j ->> 'void_reason');
  else
    act := 'update';
  end if;

  if require_reason and reason is null then
    raise exception 'A reason is required to change a submitted record in %.', tg_table_name
      using errcode = 'P0001';
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, changed_fields, old_data, new_data, reason)
  values (
    tg_table_name, new.id::text, act, auth.uid(), fields,
    (select jsonb_object_agg(k, old_j -> k) from unnest(fields) k),
    (select jsonb_object_agg(k, new_j -> k) from unnest(fields) k),
    reason
  );
  return new;
end;
$$;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

-- readings: keep demo minutes_late as generated
create or replace function public.readings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p   public.parameters;
  f   public.register_fields;
  sec public.register_sections;
begin
  if tg_op = 'UPDATE' then
    new.register_id := old.register_id; new.field_id := old.field_id; new.asset_id := old.asset_id;
    new.parameter_id := old.parameter_id; new.log_date := old.log_date; new.slot_key := old.slot_key;
    new.reading_for := old.reading_for; new.recorded_by_type := old.recorded_by_type;
    new.recorded_by_id := old.recorded_by_id; new.recorded_at := old.recorded_at;
    new.minutes_late := old.minutes_late; new.is_demo := old.is_demo;
    if new.value_num is distinct from old.value_num or new.value_text is distinct from old.value_text then
      new.amended := true;
    end if;
  else
    select * into f from public.register_fields where id = new.field_id;
    if f.id is null then raise exception 'Unknown register field.' using errcode = 'P0001'; end if;
    select * into sec from public.register_sections where id = f.section_id;
    new.register_id := sec.register_id;
    new.parameter_id := f.parameter_id;
    if f.asset_id is not null then
      new.asset_id := f.asset_id;
    elsif not exists (select 1 from public.register_assets where register_id = sec.register_id and asset_id = new.asset_id) then
      raise exception 'That equipment is not on this register.' using errcode = 'P0001';
    end if;
    if not new.is_demo then
      new.minutes_late := greatest(0, floor(extract(epoch from (new.recorded_at - new.reading_for)) / 60))::int;
    end if;
  end if;

  select * into p from public.parameters where id = new.parameter_id;
  if p.data_type = 'number' then
    if new.value_num is null then
      raise exception '% needs a number.', p.name using errcode = 'P0001';
    end if;
    new.value_text := null;
  elsif p.data_type = 'select' then
    if new.value_text is null or not (new.value_text = any (p.options)) then
      raise exception '% must be one of: %', p.name, array_to_string(p.options, ', ') using errcode = 'P0001';
    end if;
    new.value_num := null;
  end if;

  new.status := public.evaluate_value(p, new.value_num, new.value_text);

  if new.status in ('out_of_spec', 'critical') and new.voided_at is null
     and coalesce(trim(new.comment), '') = '' and coalesce(trim(new.action_taken), '') = '' then
    raise exception '% is out of spec. Add a comment or the action taken.', p.name using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.readings_before_write() from public, anon, authenticated;

-- signed-in users can never create demo rows
alter policy readings_insert on public.readings
  with check (
    public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
    and recorded_by_type = 'person' and not is_demo
  );
alter policy downtime_insert on public.downtime_events
  with check (public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
              and recorded_by_type = 'person' and not is_demo);
alter policy rcas_write on public.rcas
  with check (public.is_engineer_or_above() and not is_demo);

-- Demo generator without trigger switching.
create or replace function public.generate_demo_data(p_days int, p_operator uuid, p_engineer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reg_keys text[] := array['u1-boiler', 'u1-compressor-oilfree', 'u1-dryer-ir', 'u1-trane', 'u1-wtp', 'u1-gu-shift'];
  n_read int := 0; n_dt int := 0;
  i int;
  a record;
  fm record;
  st timestamptz;
  hrs numeric;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can generate demo data.' using errcode = 'P0001';
  end if;
  if p_days < 1 or p_days > 120 then
    raise exception 'Choose between 1 and 120 days.' using errcode = 'P0001';
  end if;

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
    insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num, value_text, comment,
                                 minutes_late, recorded_by_type, recorded_by_id, recorded_at, is_demo)
    select v.field_id, v.asset_id, v.log_date, v.slot_key, v.due_at, v.v_num, v.v_text,
           case when public.evaluate_value(v.p, v.v_num, v.v_text) in ('out_of_spec', 'critical')
                then 'DEMO: value outside standard, engineer informed' end,
           lat.m, 'person', p_operator, v.due_at + make_interval(mins => lat.m), true
      from vals v
      cross join lateral (select case when random() < 0.9 then floor(random() * 20)::int
                                      else 30 + floor(random() * 90)::int end as m) lat
     where random() > 0.02
    on conflict do nothing
    returning 1
  ) select count(*) into n_read from ins;

  for i in 1 .. greatest(6, p_days / 3) loop
    select id, area into a from public.assets
     where code in ('BLR-01', 'BLR-02', 'BLR-05', 'CMP-03', 'CMP-05', 'CMP-07', 'DRY-06', 'CHT-01', 'CHT-02', 'PMP-RW', 'UV-02')
     order by random() limit 1;
    select value as mode, parent as cat into fm from public.lists
     where list_name = 'failure_mode' and parent not in ('Planned Maintenance') order by random() limit 1;
    st := now() - make_interval(days => 1 + floor(random() * (p_days - 1))::int, hours => floor(random() * 24)::int);
    hrs := case when random() < 0.25 then 4 + random() * 10 else 0.3 + random() * 3 end;
    insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, issue_description,
                                        start_at, end_at, immediate_action, attended_by, production_impact, status, remarks,
                                        recorded_by_type, recorded_by_id, recorded_at, is_demo)
    values (a.id, case when extract(hour from st at time zone 'Africa/Lagos') between 7 and 18 then 'day' else 'night' end,
            'Unplanned Breakdown', fm.cat, fm.mode,
            (select value from public.lists where list_name = 'issue_description' order by random() limit 1),
            st, st + make_interval(secs => (hrs * 3600)::int), 'DEMO: fault rectified and equipment restarted',
            (select value from public.lists where list_name = 'attended_by' order by random() limit 1),
            (select value from public.lists where list_name = 'production_impact' order by random() limit 1),
            'Closed', 'DEMO record', 'person', p_operator, st + interval '20 minutes', true);
    n_dt := n_dt + 1;
  end loop;
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status, remarks,
                                      recorded_by_type, recorded_by_id, recorded_at, is_demo)
  values ((select id from public.assets where code = 'CMP-04'), 'day', 'Planned Maintenance', 'Planned Maintenance',
          'Planned preventive maintenance', now() - interval '5 days', now() - interval '5 days' + interval '6 hours', 'Closed',
          'DEMO record', 'person', p_operator, now() - interval '5 days', true),
         ((select id from public.assets where code = 'CHT-04'), 'day', 'Unplanned Breakdown', 'Maintenance and Spares',
          'Spare parts unavailable', now() - interval '30 hours', null, 'Awaiting Spares', 'DEMO record', 'person', p_operator,
          now() - interval '30 hours', true);
  n_dt := n_dt + 2;

  insert into public.rcas (downtime_id, asset_id, problem, why1, why2, why3, root_cause, category_6m, corrective_action,
                           preventive_action, action_type, cost_ngn, owner_id, target_date, status, created_by, is_demo)
  select e.id, e.asset_id, 'DEMO: ' || e.failure_mode || ' on ' || (select code from public.assets where id = e.asset_id),
         'Equipment stopped', 'Component failed', 'Inspection interval too long', 'PM interval not matched to duty',
         'Machine (equipment / design)', 'Component replaced', 'PM task frequency revised',
         'Preventive Maintenance Revision', 150000, p_engineer,
         (now() at time zone 'Africa/Lagos')::date + (case when random() < 0.5 then -3 else 10 end),
         'Action In Progress', p_engineer, true
    from public.downtime_events e where e.is_demo and e.rca_required
   order by e.start_at desc limit 3;

  insert into public.duty_sessions (profile_id, shift_date, shift, areas, checked_in_at, checked_out_at, handover_note, open_flags_at_checkout, is_demo)
  values (p_engineer, public.log_date_of(now()) - 1, 'day', '{U1,U2}',
          public.lagos_ts(public.log_date_of(now()) - 1, '06:52'), public.lagos_ts(public.log_date_of(now()) - 1, '19:08'),
          'DEMO: Boiler 2 flame signal low at 15:00, burner cleaned. Compressor 5 running hot, monitor.', 2, true)
  on conflict do nothing;

  perform public.run_flag_job();
  return jsonb_build_object('readings', n_read, 'downtime_events', n_dt);
end;
$$;
revoke execute on function public.generate_demo_data(int, uuid, uuid) from public, anon;
