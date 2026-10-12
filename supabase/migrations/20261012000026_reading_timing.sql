-- Reading slot timing (owner request 2026-10-12):
--  * a slot opens reading_early_window_min (15) minutes before its time; an entry before that is an EARLY entry and is flagged
--  * a slot with nothing recorded reading_missing_after_min (60) minutes after its time is flagged MISSING
--  * on registers that cover several machines, every machine is expected; a machine with an open downtime event
--    (breakdown, planned maintenance, idle/standby) at the slot time is not expected
--  * all registers are monitored, from the go-live moment in reading_monitor_from (no flood of past slots)
--  * reading_for is always worked out on the server from the slot, never taken from the phone

update public.app_settings set value = '60'::jsonb,
       description = 'A reading becomes "missing" (flagged) this many minutes after its slot time.'
 where key = 'reading_missing_after_min';
insert into public.app_settings (key, value, description) values
  ('reading_early_window_min', '15'::jsonb,
   'A slot opens this many minutes before its time. Readings entered before that are flagged as early entries.'),
  ('reading_monitor_from', to_jsonb(now()),
   'Missing-reading flags are raised only for slots due after this moment (set at go-live).')
on conflict (key) do nothing;

update public.registers set monitor = true where active;
alter table public.registers alter column monitor set default true;

-- When a slot opens for entry.
create or replace function public.slot_opens(p_kind public.slot_kind, p_log_date date, p_slot text, p_early_min numeric)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'time' then public.slot_due(p_kind, p_log_date, p_slot) - make_interval(mins => p_early_min::int)
    when 'shift' then public.lagos_ts(p_log_date, case p_slot when 'day' then time '07:00' else time '19:00' end)
    else public.lagos_ts(p_log_date, time '07:00') end
$$;

alter table public.readings add column minutes_early int not null default 0;
comment on column public.readings.minutes_early is 'Minutes before the slot opened that the reading was entered (0 = on time or late).';

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
  opens timestamptz;
begin
  if tg_op = 'UPDATE' then
    new.register_id := old.register_id; new.field_id := old.field_id; new.asset_id := old.asset_id;
    new.parameter_id := old.parameter_id; new.log_date := old.log_date; new.slot_key := old.slot_key;
    new.reading_for := old.reading_for; new.recorded_by_type := old.recorded_by_type;
    new.recorded_by_id := old.recorded_by_id; new.recorded_at := old.recorded_at;
    new.minutes_late := old.minutes_late; new.minutes_early := old.minutes_early; new.is_demo := old.is_demo;
    new.entry_method := old.entry_method; new.photo_path := old.photo_path;
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
    if not exists (select 1 from public.register_slots(new.log_date) rs
                    where rs.section_id = sec.id and rs.slot_key = new.slot_key) then
      raise exception 'Slot % is not a reading time on this register.', new.slot_key using errcode = 'P0001';
    end if;
    -- the slot decides the time a reading is for, not the phone
    new.reading_for := public.slot_due(sec.slot_kind, new.log_date, new.slot_key);
    if not new.is_demo then
      opens := public.slot_opens(sec.slot_kind, new.log_date, new.slot_key, public.setting_num('reading_early_window_min', 15));
      if now() < opens - interval '24 hours' then
        raise exception 'That slot is more than a day away. Check the date.' using errcode = 'P0001';
      end if;
      new.minutes_early := greatest(0, ceil(extract(epoch from (opens - now())) / 60))::int;
      new.minutes_late := greatest(0, floor(extract(epoch from (now() - new.reading_for)) / 60))::int;
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

-- Machines expected to be read for a section slot: every machine on the register (or the machines pinned to
-- the section's fields), except those with an open downtime event at the slot time.
create or replace function public.slot_expected_assets(p_section uuid, p_due timestamptz)
returns table (asset_id uuid)
language sql
stable
set search_path = public
as $$
  with sec as (select * from public.register_sections where id = p_section),
  pinned as (select distinct f.asset_id from public.register_fields f where f.section_id = p_section and f.active and f.asset_id is not null),
  shared as (select ra.asset_id from public.register_assets ra join sec on ra.register_id = sec.register_id
              where exists (select 1 from public.register_fields f where f.section_id = p_section and f.active and f.asset_id is null))
  select a.asset_id from (select asset_id from pinned union select asset_id from shared) a
   where not exists (select 1 from public.downtime_events e
                      where e.asset_id = a.asset_id and e.voided_at is null and e.start_at <= p_due
                        and (e.end_at is null or e.end_at >= p_due))
$$;

create or replace function public.run_reading_flags()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  missing_after numeric := public.setting_num('reading_missing_after_min', 60);
  monitor_from timestamptz := (select (value #>> '{}')::timestamptz from public.app_settings where key = 'reading_monitor_from');
  n_new int := 0; n_res int := 0; n_early int := 0;
begin
  -- MISSING: slot time + grace has passed and at least one expected machine has nothing recorded
  with slots as (
    select rs.*, d::date as log_date
      from generate_series(public.log_date_of(now()) - 1, public.log_date_of(now()), interval '1 day') d,
           lateral public.register_slots(d::date) rs
      join public.registers r on r.id = rs.register_id
     where r.monitor
       and rs.due_at + make_interval(mins => missing_after::int) < now()
       and rs.due_at > now() - interval '36 hours'
       and (monitor_from is null or rs.due_at >= monitor_from)
  ), gaps as (
    select sl.register_id, sl.section_id, sl.log_date, sl.slot_key, sl.due_at,
           array_agg(a.code order by a.code) as codes
      from slots sl
      cross join lateral public.slot_expected_assets(sl.section_id, sl.due_at) ea
      join public.assets a on a.id = ea.asset_id
     where not exists (select 1 from public.readings rd join public.register_fields rf on rf.id = rd.field_id
                        where rf.section_id = sl.section_id and rd.log_date = sl.log_date and rd.slot_key = sl.slot_key
                          and rd.asset_id = ea.asset_id and rd.voided_at is null)
     group by 1, 2, 3, 4, 5
  ), ins as (
    insert into public.flags (ref_key, kind, severity, area, register_id, section_id, log_date, slot_key, title, detail, due_at)
    select 'miss:' || g.section_id || ':' || g.log_date || ':' || g.slot_key, 'reading_missing', 'warning', r.area, r.id,
           g.section_id, g.log_date, g.slot_key,
           format('Missing: %s %s (%s)%s', r.title,
                  case when g.slot_key ~ '^\d' then g.slot_key else initcap(g.slot_key) end, r.document_no,
                  case when cardinality(g.codes) > 1 then format(' – %s machines', cardinality(g.codes)) else ' – ' || g.codes[1] end),
           format('Due %s, nothing recorded %s min later for: %s', to_char(g.due_at at time zone 'Africa/Lagos', 'DD Mon HH24:MI'),
                  missing_after, array_to_string(g.codes, ', ')),
           g.due_at
      from gaps g join public.registers r on r.id = g.register_id
    on conflict (ref_key) do update set detail = excluded.detail, title = excluded.title
      where public.flags.resolved_at is null
    returning (xmax = 0) as inserted
  ) select count(*) filter (where inserted) into n_new from ins;

  -- resolve once every expected machine has a reading (entered late) or has gone down
  with res as (
    update public.flags f set resolved_at = now(), resolution_note = 'Readings entered (late)'
     where f.kind = 'reading_missing' and f.resolved_at is null and f.section_id is not null
       and not exists (select 1 from public.slot_expected_assets(f.section_id, f.due_at) ea
                        where not exists (select 1 from public.readings rd join public.register_fields rf on rf.id = rd.field_id
                                           where rf.section_id = f.section_id and rd.log_date = f.log_date
                                             and rd.slot_key = f.slot_key and rd.asset_id = ea.asset_id and rd.voided_at is null))
    returning 1
  ) select count(*) into n_res from res;

  -- EARLY: one flag per slot, machine and person when readings were entered before the slot opened
  with e as (
    select rd.register_id, rf.section_id, rd.asset_id, rd.log_date, rd.slot_key, rd.recorded_by_id,
           max(rd.minutes_early) as mins, min(rd.recorded_at) as at, count(*) as n
      from public.readings rd join public.register_fields rf on rf.id = rd.field_id
     where rd.minutes_early > 0 and rd.voided_at is null and not rd.is_demo and rd.recorded_at > now() - interval '2 days'
     group by 1, 2, 3, 4, 5, 6
  ), ins2 as (
    insert into public.flags (ref_key, kind, severity, area, register_id, asset_id, section_id, log_date, slot_key, title, detail, due_at)
    select 'early:' || e.section_id || ':' || e.asset_id || ':' || e.log_date || ':' || e.slot_key || ':' || coalesce(e.recorded_by_id::text, '-'),
           'reading_early', 'warning', r.area, r.id, e.asset_id, e.section_id, e.log_date, e.slot_key,
           format('Early entry: %s %s %s by %s', r.title, a.code, e.slot_key, coalesce(p.full_name, 'unknown')),
           format('%s value(s) entered %s min before the slot opened (%s). Check they were really read from the equipment.',
                  e.n, e.mins, to_char(e.at at time zone 'Africa/Lagos', 'DD Mon HH24:MI')),
           e.at
      from e join public.registers r on r.id = e.register_id
      join public.assets a on a.id = e.asset_id
      left join public.profiles p on p.id = e.recorded_by_id
    on conflict (ref_key) do nothing
    returning 1
  ) select count(*) into n_early from ins2;

  return jsonb_build_object('new_missing', n_new, 'resolved_missing', n_res, 'early', n_early);
end;
$$;
revoke execute on function public.run_reading_flags() from public, anon, authenticated;

create or replace function public.run_flag_job()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  eng_after     numeric := public.setting_num('escalate_engineer_after_min', 15);
  mgr_after     numeric := public.setting_num('escalate_manager_after_min', 45);
  checkin_after numeric := public.setting_num('checkin_alert_after_min', 30);
  digest_hour   numeric := public.setting_num('digest_hour', 7);
  cs record;
  n_new int := 0; n_resolved int := 0; n_notes int := 0;
  rec record;
begin
  -- 1. Missing and early readings (see run_reading_flags)
  select (r->>'new_missing')::int, (r->>'resolved_missing')::int into n_new, n_resolved
    from public.run_reading_flags() r;

  -- 2. Out-of-spec and critical readings (last 24 h)
  insert into public.flags (ref_key, kind, severity, area, register_id, asset_id, reading_id, title, detail, due_at, is_demo)
  select 'read:' || rd.id,
         case rd.status when 'critical' then 'critical' else 'out_of_spec' end,
         case rd.status when 'critical' then 'critical' else 'warning' end,
         r.area, rd.register_id, rd.asset_id, rd.id,
         format('%s: %s = %s %s', a.code, p.name, coalesce(rd.value_num::text, rd.value_text), coalesce(p.unit, '')),
         format('Standard %s. Comment: %s', coalesce(p.standard_as_written, '—'), coalesce(rd.comment, rd.action_taken, '—')),
         rd.reading_for, rd.is_demo
    from public.readings rd
    join public.registers r on r.id = rd.register_id
    join public.assets a on a.id = rd.asset_id
    join public.parameters p on p.id = rd.parameter_id
   where rd.status in ('out_of_spec', 'critical') and rd.voided_at is null
     and rd.recorded_at > now() - interval '24 hours'
  on conflict (ref_key) do nothing;

  -- 3. Nobody checked in for the current shift
  select * into cs from public.current_shift();
  if now() > cs.starts_at + make_interval(mins => checkin_after::int) then
    insert into public.flags (ref_key, kind, severity, area, title, detail, due_at)
    select 'nocheckin:' || cs.shift_date || ':' || cs.shift || ':' || ar, 'no_checkin', 'warning', ar::area_code,
           format('No engineer checked in: %s %s shift', case ar when 'U1' then 'Utility 1' else 'Utility 2' end, cs.shift),
           format('Nobody had checked in %s minutes after the shift started.', checkin_after),
           cs.starts_at + make_interval(mins => checkin_after::int)
      from unnest(array['U1', 'U2']) ar
     where not exists (select 1 from public.duty_sessions ds join public.profiles pr on pr.id = ds.profile_id
                        where ds.shift_date = cs.shift_date and ds.shift = cs.shift and ar::area_code = any (ds.areas)
                          and pr.role in ('engineer', 'shift_manager', 'section_manager', 'admin'))
    on conflict (ref_key) do nothing;
  end if;

  -- 4. Downtime still open after 24 h
  insert into public.flags (ref_key, kind, severity, area, asset_id, downtime_id, title, detail, due_at, is_demo)
  select 'dt:' || e.id, 'downtime_open', 'warning', e.area, e.asset_id, e.id,
         format('%s %s still open', e.event_no, a.code),
         format('%s since %s (%s h).', e.failure_mode, to_char(e.start_at at time zone 'Africa/Lagos', 'DD Mon HH24:MI'),
                public.downtime_hours(e)),
         e.start_at + interval '24 hours', e.is_demo
    from public.downtime_events e join public.assets a on a.id = e.asset_id
   where e.status <> 'Closed' and e.voided_at is null and e.start_at < now() - interval '24 hours'
  on conflict (ref_key) do nothing;
  update public.flags f set resolved_at = now(), resolution_note = 'Downtime closed'
   where f.kind = 'downtime_open' and f.resolved_at is null
     and exists (select 1 from public.downtime_events e where e.id = f.downtime_id and (e.status = 'Closed' or e.voided_at is not null));

  -- 5. RCA past target date
  insert into public.flags (ref_key, kind, severity, area, asset_id, rca_id, title, due_at, is_demo)
  select 'rca:' || x.id || ':' || x.target_date, 'rca_overdue', 'warning', a.area, x.asset_id, x.id,
         format('%s overdue (target %s)', x.rca_no, to_char(x.target_date, 'DD Mon')),
         public.lagos_ts(x.target_date + 1, time '00:00'), x.is_demo
    from public.rcas x join public.assets a on a.id = x.asset_id
   where x.target_date < public.lagos_now()::date and x.voided_at is null
     and x.status not in ('Closed - Verified Effective', 'Completed - Pending Verification')
  on conflict (ref_key) do nothing;

  -- 6. Escalation ladder. Level 1: on-duty engineers; level 2: shift managers.
  update public.flags set escalation_level = 2, last_escalated_at = now()
   where resolved_at is null and acknowledged_at is null and escalation_level < 2
     and (severity = 'critical' or raised_at < now() - make_interval(mins => mgr_after::int));
  update public.flags set escalation_level = 1, last_escalated_at = now()
   where resolved_at is null and acknowledged_at is null and escalation_level < 1
     and raised_at < now() - make_interval(mins => eng_after::int);

  -- One batched message per recipient per run (avoids alert fatigue).
  for rec in
    with targets as (
      select f.id as flag_id, f.title, f.escalation_level, p.id as pid, p.email, p.whatsapp
        from public.flags f
        join public.profiles p on p.active and p.email is not null
       where f.resolved_at is null and f.acknowledged_at is null and f.escalation_level >= 1
         and f.last_escalated_at > now() - interval '6 minutes'
         and ((f.escalation_level = 1 and exists (select 1 from public.duty_sessions ds
                                                 where ds.profile_id = p.id and ds.checked_out_at is null
                                                   and (f.area is null or f.area = any (ds.areas))
                                                   and p.role in ('engineer', 'shift_manager')))
           or (f.escalation_level = 2 and p.role = 'shift_manager' and (f.area is null or f.area = any (p.areas))))
    )
    select pid, email, whatsapp, array_agg(flag_id) ids,
           array_to_string((array_agg('• ' || title order by title))[1:30], E'\n')
             || case when count(*) > 30 then format(E'\n…and %s more', count(*) - 30) else '' end lines,
           count(*) n
      from targets group by pid, email, whatsapp
  loop
    insert into public.notifications (dedupe_key, recipient_id, recipient_email, recipient_phone, channel, kind, subject, body, flag_ids)
    values ('esc:' || rec.pid || ':' || to_char(now(), 'YYYYMMDDHH24MI'), rec.pid, rec.email, rec.whatsapp, 'email', 'escalation',
            format('[CHI Utility] %s item(s) need attention', rec.n),
            rec.lines || E'\n\nOpen the app to acknowledge: Flags page.', rec.ids)
    on conflict (dedupe_key) do nothing;
    n_notes := n_notes + 1;
  end loop;

  -- 7. Daily compliance digest to section managers
  if extract(hour from public.lagos_now()) = digest_hour then
    insert into public.notifications (dedupe_key, recipient_id, recipient_email, channel, kind, subject, body)
    select 'digest:' || p.id || ':' || public.lagos_now()::date, p.id, p.email, 'email', 'digest',
           format('[CHI Utility] Daily compliance digest %s', to_char(public.lagos_now(), 'DD Mon YYYY')),
           (select format(E'Last 24 hours\n• Missing reading slots: %s\n• Out-of-spec readings: %s (critical: %s)\n• Open flags: %s\n• Open downtime events: %s\n• RCAs overdue: %s',
                   (select count(*) from public.flags where kind = 'reading_missing' and raised_at > now() - interval '24 hours'),
                   (select count(*) from public.readings where status in ('out_of_spec', 'critical') and voided_at is null and recorded_at > now() - interval '24 hours'),
                   (select count(*) from public.readings where status = 'critical' and voided_at is null and recorded_at > now() - interval '24 hours'),
                   (select count(*) from public.flags where resolved_at is null),
                   (select count(*) from public.downtime_events where status <> 'Closed' and voided_at is null),
                   (select count(*) from public.flags where kind = 'rca_overdue' and resolved_at is null)))
      from public.profiles p
     where p.active and p.role = 'section_manager' and p.email is not null
    on conflict (dedupe_key) do nothing;
  end if;

  return jsonb_build_object('new_missing', n_new, 'resolved_missing', n_resolved, 'escalation_messages', n_notes);
end;
$$;
revoke execute on function public.run_flag_job() from public, anon, authenticated;
