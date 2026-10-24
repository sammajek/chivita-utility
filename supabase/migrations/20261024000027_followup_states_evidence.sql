-- Downtime follow-up (containment → further action → completely resolved), more sections in "Attended by",
-- equipment availability / standby / unavailable state (branched by reason), equipment PM code and specs,
-- photo & document evidence, PM period affirmation (sign-off), and running-hours service intervals.

-- ---------------------------------------------------------------- Lists
insert into public.lists (list_name, value, sort) values
  ('attended_by', 'Mechanical Section', 10), ('attended_by', 'Production', 11), ('attended_by', 'Quality Assurance', 12),
  ('attended_by', 'Projects', 13), ('attended_by', 'HSE', 14), ('attended_by', 'Facilities / Civil', 15),
  ('downtime_type', 'Condition-Based Maintenance (CBM)', 5)
on conflict (list_name, value) do nothing;

-- ---------------------------------------------------------------- Downtime follow-up
alter table public.downtime_events add column followup_stage text
  check (followup_stage in ('containment', 'further_action', 'resolved'));
comment on column public.downtime_events.followup_stage is
  'Latest follow-up: containment (temporary fix), further_action (more work requested), resolved (completely resolved).';

create table public.downtime_followups (
  id               uuid primary key default gen_random_uuid(),
  downtime_id      uuid not null references public.downtime_events (id),
  stage            text not null check (stage in ('containment', 'further_action', 'resolved')),
  note             text not null check (length(trim(note)) >= 3),
  action_owner     text,
  target_date      date,
  completed_at     timestamptz,
  completed_by     uuid references auth.users (id),
  completion_note  text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false,
  check (stage <> 'further_action' or (coalesce(trim(action_owner), '') <> '' and target_date is not null))
);
create index downtime_followups_dt_idx on public.downtime_followups (downtime_id, recorded_at);

create or replace function public.downtime_followups_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare e public.downtime_events;
begin
  if tg_op = 'INSERT' then
    select * into e from downtime_events where id = new.downtime_id;
    if e.id is null or e.voided_at is not null then
      raise exception 'Downtime event not found.' using errcode = 'P0001';
    end if;
    if new.stage = 'resolved' and not new.is_demo and not public.is_engineer_or_above() then
      raise exception 'Only engineers and managers can mark an event completely resolved.' using errcode = 'P0001';
    end if;
    if new.stage = 'resolved' and e.end_at is null then
      raise exception 'Enter the downtime end time before marking it completely resolved.' using errcode = 'P0001';
    end if;
    if not new.is_demo then new.reading_for := now(); end if;
  elsif new.downtime_id <> old.downtime_id or new.stage <> old.stage or new.note <> old.note
        or new.recorded_at <> old.recorded_at or new.target_date is distinct from old.target_date then
    raise exception 'A follow-up cannot be changed. Void it with a reason and add a new one.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.downtime_followups_before_write() from public, anon, authenticated;

-- Keep downtime_events.followup_stage = the latest non-void follow-up.
create or replace function public.downtime_followups_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.downtime_events e
     set followup_stage = (select f.stage from public.downtime_followups f
                            where f.downtime_id = e.id and f.voided_at is null
                            order by f.recorded_at desc limit 1)
   where e.id = new.downtime_id;
  return null;
end;
$$;
revoke execute on function public.downtime_followups_after_write() from public, anon, authenticated;

create trigger downtime_followups_stamp before insert on public.downtime_followups
  for each row execute function public.stamp_recorded();
create trigger downtime_followups_before_write before insert or update on public.downtime_followups
  for each row execute function public.downtime_followups_before_write();
create trigger downtime_followups_after_write after insert or update on public.downtime_followups
  for each row execute function public.downtime_followups_after_write();
select public.enable_audit('public.downtime_followups', false);

-- The person who owns a further action (or an engineer) marks it done.
create or replace function public.complete_followup(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') then
    raise exception 'Not allowed.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_note)), 0) < 3 then
    raise exception 'Say what was done.' using errcode = 'P0001';
  end if;
  perform public.set_change_reason('Further action completed: ' || p_note);
  update public.downtime_followups set completed_at = now(), completed_by = auth.uid(), completion_note = p_note
   where id = p_id and stage = 'further_action' and completed_at is null and voided_at is null;
  if not found then raise exception 'Open further action not found.' using errcode = 'P0001'; end if;
end;
$$;
revoke execute on function public.complete_followup(uuid, text) from public, anon;

create or replace function public.void_followup(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can void a follow-up.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.downtime_followups set voided_at = now(), void_reason = p_reason where id = p_id and voided_at is null;
end;
$$;
revoke execute on function public.void_followup(uuid, text) from public, anon;

-- ---------------------------------------------------------------- Equipment state (available / standby / unavailable)
alter table public.assets add column op_state text not null default 'available'
  check (op_state in ('available', 'standby', 'unavailable'));
alter table public.assets add column op_reason text;
alter table public.assets add column op_since timestamptz;
alter table public.assets add column pm_code text;
alter table public.assets add column serial_no text;
alter table public.assets add column location text;
alter table public.assets add column year_installed int check (year_installed is null or year_installed between 1950 and 2100);
alter table public.assets add column specs text;
comment on column public.assets.op_state is
  'Live state: available (running/ready), standby (healthy, not needed), unavailable (cannot run: see op_reason).';
comment on column public.assets.specs is 'Free-text specifications (one per line, e.g. "Motor: 75 kW").';

create table public.asset_states (
  id               uuid primary key default gen_random_uuid(),
  asset_id         uuid not null references public.assets (id),
  state            text not null check (state in ('available', 'standby', 'unavailable')),
  reason           text check (reason in ('PM', 'Breakdown', 'CBM', 'External supply', 'Awaiting spares',
                                          'Awaiting vendor', 'Low demand', 'Other')),
  note             text,
  downtime_id      uuid references public.downtime_events (id),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  is_demo          boolean not null default false,
  check (state <> 'unavailable' or reason is not null),
  check (reason <> 'Other' or coalesce(trim(note), '') <> ''),
  check (ended_at is null or ended_at >= started_at)
);
create unique index asset_states_one_open on public.asset_states (asset_id) where ended_at is null;
create index asset_states_asset_idx on public.asset_states (asset_id, started_at);
create trigger asset_states_stamp before insert on public.asset_states for each row execute function public.stamp_recorded();
select public.enable_audit('public.asset_states', false);

-- Internal: close the open state row and open a new one (no role check; callers check).
create or replace function public.apply_asset_state(p_asset uuid, p_state text, p_reason text, p_note text,
                                                    p_downtime uuid, p_at timestamptz, p_by_type text, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare at_ts timestamptz := least(coalesce(p_at, now()), now());
begin
  update public.asset_states set ended_at = greatest(at_ts, started_at) where asset_id = p_asset and ended_at is null;
  insert into public.asset_states (asset_id, state, reason, note, downtime_id, started_at, recorded_by_type, recorded_by_id, reading_for)
  values (p_asset, p_state, case when p_state = 'available' then null else p_reason end, p_note, p_downtime, at_ts,
          p_by_type, p_by, at_ts);
  update public.assets set op_state = p_state, op_reason = case when p_state = 'available' then null else p_reason end,
                           op_since = at_ts
   where id = p_asset;
end;
$$;
revoke execute on function public.apply_asset_state(uuid, text, text, text, uuid, timestamptz, text, uuid) from public, anon, authenticated;

create or replace function public.set_asset_state(p_asset uuid, p_state text, p_reason text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') then
    raise exception 'Not allowed.' using errcode = 'P0001';
  end if;
  if p_state not in ('available', 'standby', 'unavailable') then
    raise exception 'Unknown state.' using errcode = 'P0001';
  end if;
  if p_state = 'unavailable' and p_reason is null then
    raise exception 'Pick why the equipment is unavailable.' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(coalesce(nullif(trim(p_note), ''), 'State changed to ' || p_state));
  perform public.apply_asset_state(p_asset, p_state, p_reason, p_note, null, now(), 'person', auth.uid());
end;
$$;
revoke execute on function public.set_asset_state(uuid, text, text, text) from public, anon;

-- Logging an open downtime event makes the equipment unavailable (reason follows the downtime type);
-- entering its end time makes it available again. Demo events are left alone.
create or replace function public.downtime_sync_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.asset_states;
  reason text := case new.downtime_type
    when 'Unplanned Breakdown' then 'Breakdown' when 'Planned Maintenance' then 'PM'
    when 'Condition-Based Maintenance (CBM)' then 'CBM' when 'External Supply Failure' then 'External supply'
    else null end;
  by_type text := case when auth.uid() is null then 'logger' else 'person' end;
  by_id uuid := coalesce(auth.uid(), new.recorded_by_id);
begin
  if new.is_demo or by_id is null then return null; end if;
  select * into cur from public.asset_states where asset_id = new.asset_id and ended_at is null;
  if new.voided_at is null and new.end_at is null and (tg_op = 'INSERT' or old.end_at is not null) then
    if new.downtime_type = 'Idle / Standby' then
      perform public.apply_asset_state(new.asset_id, 'standby', 'Low demand', new.event_no, new.id, new.start_at, by_type, by_id);
    elsif reason is not null then
      perform public.apply_asset_state(new.asset_id, 'unavailable', reason, new.event_no, new.id, new.start_at, by_type, by_id);
    end if;
  elsif (new.end_at is not null or new.voided_at is not null) and cur.downtime_id = new.id then
    perform public.apply_asset_state(new.asset_id, 'available', null, new.event_no || ' ended', new.id,
                                     coalesce(new.end_at, now()), by_type, by_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.downtime_sync_state() from public, anon, authenticated;
create trigger downtime_sync_state after insert or update on public.downtime_events
  for each row execute function public.downtime_sync_state();

-- Machines on standby or unavailable at the slot time are not expected to have readings.
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
     and not exists (select 1 from public.asset_states s
                      where s.asset_id = a.asset_id and s.state <> 'available' and s.started_at <= p_due
                        and (s.ended_at is null or s.ended_at >= p_due))
$$;

-- ---------------------------------------------------------------- Evidence (photos and documents)
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  entity_type      text not null check (entity_type in ('downtime', 'followup', 'pm_completion', 'pm_affirmation', 'cleaning',
                                                        'rca', 'asset', 'water_result', 'calibration', 'job_request',
                                                        'external_report', 'training')),
  entity_id        uuid not null,
  path             text not null unique,
  file_name        text not null,
  mime_type        text,
  size_bytes       int,
  caption          text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);
create trigger attachments_stamp before insert on public.attachments for each row execute function public.stamp_recorded();
select public.enable_audit('public.attachments', false);

create or replace function public.void_attachment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare a public.attachments;
begin
  select * into a from public.attachments where id = p_id and voided_at is null;
  if a.id is null then raise exception 'Attachment not found.' using errcode = 'P0001'; end if;
  if not (a.recorded_by_id = auth.uid() or public.is_engineer_or_above()) then
    raise exception 'Only the person who added it or an engineer can remove it.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.attachments set voided_at = now(), void_reason = p_reason where id = p_id;
end;
$$;
revoke execute on function public.void_attachment(uuid, text) from public, anon;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('evidence', 'evidence', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
                  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
    on conflict (id) do nothing;
    execute $p$create policy evidence_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text
                  and public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin'))$p$;
    execute $p$create policy evidence_read on storage.objects for select to authenticated
      using (bucket_id = 'evidence')$p$;
  end if;
end $$;

-- ---------------------------------------------------------------- PM affirmation (period sign-off)
create table public.pm_affirmations (
  id               uuid primary key default gen_random_uuid(),
  frequency        text not null check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'bi_annual', 'annual')),
  area             public.area_code not null,
  period_start     date not null,
  total_tasks      int not null,
  done_ok          int not null,
  done_not_ok      int not null,
  not_done         int not null,
  not_recorded     int not null,
  note             text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false
);
create unique index pm_affirmations_one on public.pm_affirmations (frequency, area, period_start) where voided_at is null;
create trigger pm_affirmations_stamp before insert on public.pm_affirmations for each row execute function public.stamp_recorded();
select public.enable_audit('public.pm_affirmations', true);

-- Engineer / manager affirms that the PM for one frequency, area and period has been checked.
-- The counts are frozen at the time of affirmation; anything not recorded needs a note.
create or replace function public.affirm_pm_period(p_freq text, p_area public.area_code, p_period date, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ps date := public.pm_period_start(p_freq, p_period);
  t int; ok int; nok int; nd int; nr int;
  new_id uuid;
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can affirm PM.' using errcode = 'P0001';
  end if;
  if ps > public.log_date_of(now()) then
    raise exception 'You cannot affirm a future period.' using errcode = 'P0001';
  end if;
  select count(*), count(*) filter (where c.result = 'done_ok'), count(*) filter (where c.result = 'done_not_ok'),
         count(*) filter (where c.result = 'not_done'), count(*) filter (where c.id is null)
    into t, ok, nok, nd, nr
    from public.pm_tasks k
    left join public.pm_completions c on c.task_id = k.id and c.period_start = ps and c.voided_at is null
   where k.active and k.frequency = p_freq and k.area = p_area;
  if t = 0 then raise exception 'No PM tasks for this frequency and area.' using errcode = 'P0001'; end if;
  if (nr > 0 or nd > 0 or nok > 0) and coalesce(length(trim(p_note)), 0) < 5 then
    raise exception 'Some PMs are not done or not recorded: add a note (5+ characters) before affirming.' using errcode = 'P0001';
  end if;
  insert into public.pm_affirmations (frequency, area, period_start, total_tasks, done_ok, done_not_ok, not_done, not_recorded,
                                      note, recorded_by_type, reading_for)
  values (p_freq, p_area, ps, t, ok, nok, nd, nr, nullif(trim(p_note), ''), 'person', now())
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'This period is already affirmed.' using errcode = 'P0001';
end;
$$;
revoke execute on function public.affirm_pm_period(text, public.area_code, date, text) from public, anon;

create or replace function public.void_pm_affirmation(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager_or_admin() then
    raise exception 'Only managers can withdraw an affirmation.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.pm_affirmations set voided_at = now(), void_reason = p_reason where id = p_id and voided_at is null;
end;
$$;
revoke execute on function public.void_pm_affirmation(uuid, text) from public, anon;

-- ---------------------------------------------------------------- Running-hours service intervals
create table public.service_intervals (
  id                 uuid primary key default gen_random_uuid(),
  asset_id           uuid not null references public.assets (id),
  pm_task_id         uuid references public.pm_tasks (id),
  interval_hours     int not null check (interval_hours > 0),
  warn_before_hours  int not null default 200 check (warn_before_hours >= 0),
  service_name       text not null,
  last_service_hours numeric,
  last_service_on    date,
  active             boolean not null default true,
  unique (asset_id, interval_hours)
);
select public.enable_audit('public.service_intervals', false);

create table public.service_records (
  id               uuid primary key default gen_random_uuid(),
  interval_id      uuid not null references public.service_intervals (id),
  service_hours    numeric not null check (service_hours >= 0),
  serviced_on      date not null,
  note             text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false
);
create trigger service_records_stamp before insert on public.service_records for each row execute function public.stamp_recorded();
select public.enable_audit('public.service_records', true);

-- Latest running-hours counter logged for an asset (from the equipment registers).
create or replace function public.asset_running_hours(p_asset uuid)
returns table (hours numeric, read_at timestamptz)
language sql
stable
set search_path = public
as $$
  select r.value_num, r.reading_for
    from public.readings r join public.parameters p on p.id = r.parameter_id
   where r.asset_id = p_asset and r.voided_at is null and r.value_num is not null and p.is_counter
     and p.name in ('Running Hours', 'Operating Hours', 'Compressor Running Time')
   order by r.reading_for desc, r.recorded_at desc
   limit 1
$$;

-- A service of N hours also counts for the smaller intervals on the same machine (e.g. 8000 h covers 4000 h and 2000 h).
create or replace function public.service_records_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare si public.service_intervals;
begin
  select * into si from public.service_intervals where id = new.interval_id;
  update public.service_intervals
     set last_service_hours = new.service_hours, last_service_on = new.serviced_on
   where asset_id = si.asset_id and interval_hours <= si.interval_hours
     and (last_service_hours is null or last_service_hours <= new.service_hours);
  return null;
end;
$$;
revoke execute on function public.service_records_after_insert() from public, anon, authenticated;
create trigger service_records_after_insert after insert on public.service_records
  for each row execute function public.service_records_after_insert();

create or replace function public.record_service(p_interval uuid, p_hours numeric, p_date date, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') then
    raise exception 'Not allowed.' using errcode = 'P0001';
  end if;
  if p_date > public.lagos_now()::date then
    raise exception 'The service date cannot be in the future.' using errcode = 'P0001';
  end if;
  insert into public.service_records (interval_id, service_hours, serviced_on, note, recorded_by_type, reading_for)
  values (p_interval, p_hours, p_date, nullif(trim(p_note), ''), 'person', public.lagos_ts(p_date, time '12:00'));
end;
$$;
revoke execute on function public.record_service(uuid, numeric, date, text) from public, anon;

-- One interval per running-hours PM task (compressors: 2000 / 4000 / 8000 / 16000 h). Re-run after the PM library loads.
create or replace function public.sync_service_intervals()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into public.service_intervals (asset_id, pm_task_id, interval_hours, service_name)
  select distinct on (k.asset_id, k.hours_interval) k.asset_id, k.id, k.hours_interval,
         format('%s h service', k.hours_interval)
    from public.pm_tasks k
   where k.hours_interval is not null and k.asset_id is not null and k.active
   order by k.asset_id, k.hours_interval, k.register_sn
  on conflict (asset_id, interval_hours) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.sync_service_intervals() from public, anon, authenticated;
select public.sync_service_intervals();

create or replace function public.pm_tasks_sync_intervals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_service_intervals();
  return null;
end;
$$;
revoke execute on function public.pm_tasks_sync_intervals() from public, anon, authenticated;
create trigger pm_tasks_sync_intervals after insert or update on public.pm_tasks
  for each statement execute function public.pm_tasks_sync_intervals();

-- ---------------------------------------------------------------- Flags
alter table public.flags add column followup_id uuid references public.downtime_followups (id);
alter table public.flags add column service_interval_id uuid references public.service_intervals (id);
alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'reading_early', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue',
  'pm_overdue', 'pm_followup', 'amc_past_due', 'water_alert', 'water_action', 'calibration_due',
  'followup_overdue', 'hours_service_due'));

create or replace function public.run_ops_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := public.lagos_now()::date;
  n int := 0; m int := 0;
begin
  -- further action past its target date while the event is not resolved
  insert into public.flags (ref_key, kind, severity, area, asset_id, downtime_id, followup_id, title, detail, due_at, is_demo)
  select 'fu:' || f.id, 'followup_overdue', 'warning', e.area, e.asset_id, e.id, f.id,
         format('Further action overdue: %s %s (%s)', e.event_no, a.code, f.action_owner),
         format('%s – target %s', f.note, to_char(f.target_date, 'DD Mon YYYY')),
         public.lagos_ts(f.target_date, time '23:59'), f.is_demo
    from public.downtime_followups f
    join public.downtime_events e on e.id = f.downtime_id
    join public.assets a on a.id = e.asset_id
   where f.stage = 'further_action' and f.voided_at is null and f.completed_at is null
     and f.target_date < today and e.voided_at is null and coalesce(e.followup_stage, '') <> 'resolved'
  on conflict (ref_key) do nothing;
  get diagnostics n = row_count;

  update public.flags fl set resolved_at = now(), resolution_note = 'Further action completed or event resolved'
   where fl.kind = 'followup_overdue' and fl.resolved_at is null
     and exists (select 1 from public.downtime_followups f join public.downtime_events e on e.id = f.downtime_id
                  where f.id = fl.followup_id
                    and (f.completed_at is not null or f.voided_at is not null or e.followup_stage = 'resolved'));

  -- running-hours service due: one flag per interval per service cycle
  with s as (
    select si.*, a.code, a.name, a.area, h.hours,
           si.last_service_hours + si.interval_hours as due_hours
      from public.service_intervals si
      join public.assets a on a.id = si.asset_id
      cross join lateral public.asset_running_hours(si.asset_id) h
     where si.active and si.last_service_hours is not null and a.status <> 'retired'
  )
  insert into public.flags (ref_key, kind, severity, area, asset_id, service_interval_id, title, detail, due_at)
  select 'hrs:' || s.id || ':' || s.last_service_hours, 'hours_service_due',
         case when s.hours >= s.due_hours then 'warning' else 'info' end, s.area, s.asset_id, s.id,
         format('%s %s: %s %s', s.code, s.service_name,
                case when s.hours >= s.due_hours then 'overdue' else 'due soon' end,
                format('(%s h now, due at %s h)', round(s.hours), round(s.due_hours))),
         s.name, now()
    from s
   where s.hours >= s.due_hours - s.warn_before_hours
  on conflict (ref_key) do nothing;
  get diagnostics m = row_count;

  update public.flags fl set resolved_at = now(), resolution_note = 'Service recorded'
   where fl.kind = 'hours_service_due' and fl.resolved_at is null
     and exists (select 1 from public.service_intervals si
                  where si.id = fl.service_interval_id
                    and (not si.active or si.last_service_hours::text <> split_part(fl.ref_key, ':', 3)));
  return n + m;
end;
$$;
revoke execute on function public.run_ops_flags() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_ops_flags(); select public.run_flag_job()');
  end if;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.downtime_followups enable row level security;
alter table public.asset_states enable row level security;
alter table public.attachments enable row level security;
alter table public.pm_affirmations enable row level security;
alter table public.service_intervals enable row level security;
alter table public.service_records enable row level security;
revoke all on public.downtime_followups, public.asset_states, public.attachments, public.pm_affirmations,
              public.service_intervals, public.service_records from anon;

create policy downtime_followups_read on public.downtime_followups for select to authenticated using (true);
create policy downtime_followups_insert on public.downtime_followups for insert to authenticated
  with check (public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
              and recorded_by_type = 'person' and not is_demo);
create policy asset_states_read on public.asset_states for select to authenticated using (true);
-- state changes go through set_asset_state
create policy attachments_read on public.attachments for select to authenticated using (true);
create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
              and recorded_by_type = 'person' and not is_demo
              and split_part(path, '/', 1) = auth.uid()::text);
create policy pm_affirmations_read on public.pm_affirmations for select to authenticated using (true);
create policy service_intervals_read on public.service_intervals for select to authenticated using (true);
create policy service_intervals_write on public.service_intervals for all to authenticated
  using (public.is_engineer_or_above()) with check (public.is_engineer_or_above());
create policy service_records_read on public.service_records for select to authenticated using (true);
