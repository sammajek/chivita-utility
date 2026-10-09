-- Operations: duty check-in/out, downtime & RCA, flags, escalation and
-- notifications. Thresholds come from app_settings so the section manager can
-- change them without code changes.

create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = p_key), p_default)
$$;

-- Lagos wall-clock helpers (UTC+1, no DST).
create or replace function public.lagos_ts(p_date date, p_time time)
returns timestamptz
language sql
immutable
as $$ select (p_date + p_time) at time zone 'Africa/Lagos' $$;

create or replace function public.lagos_now()
returns timestamp
language sql
stable
as $$ select now() at time zone 'Africa/Lagos' $$;

-- The register "log date": a day runs 07:00 → 07:00.
create or replace function public.log_date_of(p_at timestamptz)
returns date
language sql
immutable
as $$ select ((p_at at time zone 'Africa/Lagos') - interval '7 hours')::date $$;

alter table public.registers add column monitor boolean not null default false;
comment on column public.registers.monitor is
  'When true, the flag job raises "missing reading" flags for this register. Turn on per register at go-live.';

-- ---------------------------------------------------------------------------
-- Duty register
-- ---------------------------------------------------------------------------
create table public.duty_sessions (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles (id),
  shift_date         date not null,
  shift              text not null check (shift in ('day', 'night')),
  areas              public.area_code[] not null,
  checked_in_at      timestamptz not null default now(),
  checked_out_at     timestamptz,
  handover_note      text,
  open_flags_at_checkout integer,
  is_demo            boolean not null default false,
  unique (profile_id, shift_date, shift)
);
create index duty_sessions_shift_idx on public.duty_sessions (shift_date, shift);

create or replace function public.current_shift()
returns table (shift_date date, shift text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
set search_path = public
as $$
  with t as (select public.lagos_now() as n)
  select d, s, public.lagos_ts(d, case s when 'day' then time '07:00' else time '19:00' end),
         public.lagos_ts(d, case s when 'day' then time '07:00' else time '19:00' end) + interval '12 hours'
    from t,
    lateral (select case when n::time >= '07:00' and n::time < '19:00' then n::date
                         when n::time >= '19:00' then n::date
                         else n::date - 1 end as d,
                    case when n::time >= '07:00' and n::time < '19:00' then 'day' else 'night' end as s) x
$$;

create or replace function public.check_in(p_areas public.area_code[])
returns public.duty_sessions
language plpgsql
security definer
set search_path = public
as $$
declare cs record; r public.duty_sessions;
begin
  if not public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') then
    raise exception 'Your role cannot check in.' using errcode = 'P0001';
  end if;
  select * into cs from public.current_shift();
  insert into public.duty_sessions (profile_id, shift_date, shift, areas)
  values (auth.uid(), cs.shift_date, cs.shift, coalesce(p_areas, '{U1,U2}'))
  on conflict (profile_id, shift_date, shift) do update set areas = excluded.areas, checked_out_at = null
  returning * into r;
  -- A check-in clears this shift's "nobody checked in" flags for those areas.
  update public.flags set resolved_at = now(), resolution_note = 'Checked in'
   where kind = 'no_checkin' and resolved_at is null and area = any (r.areas)
     and ref_key like 'nocheckin:' || cs.shift_date || ':' || cs.shift || ':%';
  return r;
end;
$$;

create or replace function public.check_out(p_handover text)
returns public.duty_sessions
language plpgsql
security definer
set search_path = public
as $$
declare r public.duty_sessions; n_open int;
begin
  if coalesce(length(trim(p_handover)), 0) < 10 then
    raise exception 'Write a handover note (at least 10 characters) before checking out.' using errcode = 'P0001';
  end if;
  select * into r from public.duty_sessions
   where profile_id = auth.uid() and checked_out_at is null
   order by checked_in_at desc limit 1;
  if r.id is null then raise exception 'You are not checked in.' using errcode = 'P0001'; end if;
  select count(*) into n_open from public.flags where resolved_at is null and (area is null or area = any (r.areas));
  update public.duty_sessions
     set checked_out_at = now(), handover_note = trim(p_handover), open_flags_at_checkout = n_open
   where id = r.id returning * into r;
  -- Checking out acknowledges the open flags the person has seen.
  update public.flags set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where resolved_at is null and (area is null or area = any (r.areas));
  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Downtime (603-001 template) and RCA
-- ---------------------------------------------------------------------------
create sequence public.downtime_no_seq;
create sequence public.rca_no_seq;

create table public.downtime_events (
  id                 uuid primary key default gen_random_uuid(),
  event_no           text not null unique default ('DT-' || lpad(nextval('public.downtime_no_seq')::text, 4, '0')),
  asset_id           uuid not null references public.assets (id),
  area               public.area_code,
  shift              text not null check (shift in ('day', 'night')),
  downtime_type      text not null,
  failure_category   text not null,
  failure_mode       text not null,
  issue_description  text,
  start_at           timestamptz not null,
  end_at             timestamptz,
  override_hours     numeric check (override_hours is null or override_hours >= 0),
  override_reason    text,
  immediate_action   text,
  spares_used        text,
  attended_by        text,
  production_impact  text,
  status             text not null default 'Open',
  rca_required       boolean not null default false,
  rca_reason         text,
  remarks            text,
  recorded_by_type   text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id     uuid,
  recorded_at        timestamptz not null default now(),
  reading_for        timestamptz,
  voided_at          timestamptz,
  void_reason        text,
  is_demo            boolean not null default false,
  check (end_at is null or end_at >= start_at),
  check (override_hours is null or coalesce(trim(override_reason), '') <> '')
);
create index downtime_asset_idx on public.downtime_events (asset_id, start_at);
create index downtime_start_idx on public.downtime_events (start_at);

-- Hours exactly as the template: calculated from start/end, override wins.
create or replace function public.downtime_hours(e public.downtime_events)
returns numeric
language sql
stable
as $$
  select round(coalesce(e.override_hours,
                        extract(epoch from (coalesce(e.end_at, now()) - e.start_at)) / 3600.0)::numeric, 2)
$$;

create or replace function public.downtime_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hrs     numeric;
  repeats int;
  h_lim   numeric := public.setting_num('rca_hours_at_or_above', 4);
  r_lim   numeric := public.setting_num('rca_repeats_at_or_above', 3);
begin
  -- pick-list validation (same lists as the Excel template)
  if not exists (select 1 from lists where list_name = 'downtime_type' and value = new.downtime_type) then
    raise exception 'Unknown downtime type: %', new.downtime_type using errcode = 'P0001';
  end if;
  if not exists (select 1 from lists where list_name = 'failure_mode' and value = new.failure_mode and parent = new.failure_category) then
    raise exception 'Failure mode "%" is not in category "%".', new.failure_mode, new.failure_category using errcode = 'P0001';
  end if;
  if not exists (select 1 from lists where list_name = 'downtime_status' and value = new.status) then
    raise exception 'Unknown status: %', new.status using errcode = 'P0001';
  end if;
  if new.status = 'Closed' and new.end_at is null then
    raise exception 'Enter the end time before closing the event.' using errcode = 'P0001';
  end if;

  new.area := coalesce(new.area, (select area from assets where id = new.asset_id));
  new.reading_for := new.start_at;

  hrs := public.downtime_hours(new);
  select count(*) into repeats from downtime_events
   where asset_id = new.asset_id and failure_mode = new.failure_mode and voided_at is null
     and id <> new.id and start_at > new.start_at - interval '365 days';
  repeats := repeats + 1;

  new.rca_required := new.voided_at is null and new.downtime_type <> 'Idle / Standby'
                      and (hrs >= h_lim or repeats >= r_lim);
  new.rca_reason := case
    when not new.rca_required then null
    when hrs >= h_lim and repeats >= r_lim then format('%s h (≥ %s h) and %s repeats (≥ %s)', hrs, h_lim, repeats, r_lim)
    when hrs >= h_lim then format('%s h (≥ %s h)', hrs, h_lim)
    else format('%s repeats of "%s" on this equipment in 12 months (≥ %s)', repeats, new.failure_mode, r_lim) end;
  return new;
end;
$$;

create trigger downtime_stamp before insert on public.downtime_events
  for each row execute function public.stamp_recorded();
create trigger downtime_before_write before insert or update on public.downtime_events
  for each row execute function public.downtime_before_write();
select public.enable_audit('public.downtime_events', false);

create table public.rcas (
  id                   uuid primary key default gen_random_uuid(),
  rca_no               text not null unique default ('RCA-' || lpad(nextval('public.rca_no_seq')::text, 3, '0')),
  downtime_id          uuid references public.downtime_events (id),
  asset_id             uuid not null references public.assets (id),
  problem              text not null,
  why1                 text,
  why2                 text,
  why3                 text,
  why4                 text,
  why5                 text,
  root_cause           text,
  category_6m          text,
  corrective_action    text,
  preventive_action    text,
  action_type          text,
  capex_required       boolean not null default false,
  capex_amount_ngn     numeric,
  cost_ngn             numeric,
  owner_id             uuid references public.profiles (id),
  target_date          date,
  status               text not null default 'Not Started',
  verified_by          uuid references public.profiles (id),
  verified_at          timestamptz,
  effectiveness_note   text,
  created_by           uuid default auth.uid() references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  voided_at            timestamptz,
  void_reason          text,
  is_demo              boolean not null default false
);
create index rcas_downtime_idx on public.rcas (downtime_id);
create trigger rcas_touch before update on public.rcas for each row execute function public.touch_updated_at();
select public.enable_audit('public.rcas', false);

create or replace function public.rcas_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category_6m is not null and not exists (select 1 from lists where list_name = 'category_6m' and value = new.category_6m) then
    raise exception 'Unknown 6M category: %', new.category_6m using errcode = 'P0001';
  end if;
  if not exists (select 1 from lists where list_name = 'rca_status' and value = new.status) then
    raise exception 'Unknown RCA status: %', new.status using errcode = 'P0001';
  end if;
  if new.status = 'Closed - Verified Effective' and new.verified_at is null then
    new.verified_at := now();
    new.verified_by := coalesce(new.verified_by, auth.uid());
  end if;
  return new;
end;
$$;
create trigger rcas_before_write before insert or update on public.rcas
  for each row execute function public.rcas_before_write();

-- ---------------------------------------------------------------------------
-- Flags and notifications
-- ---------------------------------------------------------------------------
create table public.flags (
  id                uuid primary key default gen_random_uuid(),
  ref_key           text not null unique,
  kind              text not null check (kind in ('reading_missing', 'out_of_spec', 'critical', 'no_checkin',
                                                  'downtime_open', 'rca_overdue')),
  severity          text not null check (severity in ('info', 'warning', 'critical')),
  area              public.area_code,
  register_id       uuid references public.registers (id),
  asset_id          uuid references public.assets (id),
  reading_id        uuid references public.readings (id),
  downtime_id       uuid references public.downtime_events (id),
  rca_id            uuid references public.rcas (id),
  title             text not null,
  detail            text,
  due_at            timestamptz,
  raised_at         timestamptz not null default now(),
  escalation_level  smallint not null default 0,
  last_escalated_at timestamptz,
  acknowledged_at   timestamptz,
  acknowledged_by   uuid references auth.users (id),
  resolved_at       timestamptz,
  resolved_by       uuid references auth.users (id),
  resolution_note   text,
  is_demo           boolean not null default false
);
create index flags_open_idx on public.flags (raised_at desc) where resolved_at is null;

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  dedupe_key       text unique,
  created_at       timestamptz not null default now(),
  recipient_id     uuid references public.profiles (id),
  recipient_email  text,
  recipient_phone  text,
  channel          text not null check (channel in ('email', 'whatsapp', 'in_app')),
  kind             text not null check (kind in ('escalation', 'digest', 'alert')),
  subject          text not null,
  body             text not null,
  flag_ids         uuid[],
  status           text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  sent_at          timestamptz,
  error            text,
  acknowledged_at  timestamptz
);
create index notifications_queue_idx on public.notifications (created_at) where status = 'queued';
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

create or replace function public.acknowledge_flag(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.flags set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_id and public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin');
$$;

create or replace function public.resolve_flag(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can close flags.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_note)), 0) < 3 then
    raise exception 'Say how the flag was resolved.' using errcode = 'P0001';
  end if;
  update public.flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = trim(p_note),
         acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_id and resolved_at is null;
end;
$$;

-- Due time for a register slot on a log date.
create or replace function public.slot_due(p_kind public.slot_kind, p_log_date date, p_slot text)
returns timestamptz
language sql
immutable
as $$
  select case p_kind
    when 'time' then public.lagos_ts(case when p_slot::time < '07:00' then p_log_date + 1 else p_log_date end, p_slot::time)
    when 'shift' then public.lagos_ts(p_log_date, case p_slot when 'day' then time '19:00' else time '07:00' end)
                      + case p_slot when 'night' then interval '1 day' else interval '0' end
    else public.lagos_ts(p_log_date + 1, time '07:00') end
$$;

-- All slots of monitored registers for a log date, with due time.
create or replace function public.register_slots(p_log_date date)
returns table (register_id uuid, section_id uuid, slot_key text, due_at timestamptz)
language sql
stable
set search_path = public
as $$
  select s.register_id, s.id, k.slot, public.slot_due(s.slot_kind, p_log_date, k.slot)
    from public.register_sections s
    join public.registers r on r.id = s.register_id and r.active
    cross join lateral (
      select to_char(t, 'HH24:MI') as slot from unnest(s.slot_times) t where s.slot_kind = 'time'
      union all select x from unnest(array['day', 'night']) x where s.slot_kind = 'shift'
      union all select x from unnest(array['high', 'low']) x where s.slot_kind = 'daily_high_low'
      union all select 'day' where s.slot_kind = 'daily'
    ) k
$$;

-- The flag + escalation job (pg_cron runs it every 5 minutes).
create or replace function public.run_flag_job()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  missing_after numeric := public.setting_num('reading_missing_after_min', 120);
  eng_after     numeric := public.setting_num('escalate_engineer_after_min', 15);
  mgr_after     numeric := public.setting_num('escalate_manager_after_min', 45);
  checkin_after numeric := public.setting_num('checkin_alert_after_min', 30);
  digest_hour   numeric := public.setting_num('digest_hour', 7);
  cs record;
  n_new int := 0; n_resolved int := 0; n_notes int := 0;
  rec record;
begin
  -- 1. Missing readings (monitored registers, yesterday and today)
  with slots as (
    select rs.*, d::date as log_date
      from generate_series(public.log_date_of(now()) - 1, public.log_date_of(now()), interval '1 day') d,
           lateral public.register_slots(d::date) rs
      join public.registers r on r.id = rs.register_id
     where r.monitor
  ), missing as (
    select sl.* from slots sl
     where sl.due_at + make_interval(mins => missing_after::int) < now()
       and sl.due_at > now() - interval '36 hours'
       and not exists (select 1 from public.readings rd
                        join public.register_fields f on f.id = rd.field_id
                       where f.section_id = sl.section_id and rd.log_date = sl.log_date
                         and rd.slot_key = sl.slot_key and rd.voided_at is null)
  ), ins as (
    insert into public.flags (ref_key, kind, severity, area, register_id, title, detail, due_at)
    select 'miss:' || m.section_id || ':' || m.log_date || ':' || m.slot_key, 'reading_missing', 'warning', r.area, r.id,
           format('Missing: %s (%s) %s', r.title, r.document_no, m.slot_key),
           format('Readings for %s were due %s and have not been entered.', m.slot_key,
                  to_char(m.due_at at time zone 'Africa/Lagos', 'DD Mon HH24:MI')),
           m.due_at
      from missing m join public.registers r on r.id = m.register_id
    on conflict (ref_key) do nothing
    returning 1
  ) select count(*) into n_new from ins;

  -- auto-resolve missing flags once the readings arrive
  with res as (
    update public.flags f set resolved_at = now(), resolution_note = 'Readings entered (late)'
     where f.kind = 'reading_missing' and f.resolved_at is null
       and exists (select 1 from public.readings rd join public.register_fields rf on rf.id = rd.field_id
                    where rf.section_id = split_part(f.ref_key, ':', 2)::uuid
                      and rd.log_date = split_part(f.ref_key, ':', 3)::date
                      and rd.slot_key = substring(f.ref_key from '^miss:[^:]+:[^:]+:(.*)$')
                      and rd.voided_at is null)
    returning 1
  ) select count(*) into n_resolved from res;

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
    select pid, email, whatsapp, array_agg(flag_id) ids, string_agg('• ' || title, E'\n' order by title) lines, count(*) n
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

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke execute on function public.run_flag_job() from public, anon, authenticated;
revoke execute on function public.downtime_before_write() from public, anon, authenticated;
revoke execute on function public.check_in(public.area_code[]) from public, anon;
revoke execute on function public.check_out(text) from public, anon;
revoke execute on function public.acknowledge_flag(uuid) from public, anon;
revoke execute on function public.resolve_flag(uuid, text) from public, anon;

alter table public.duty_sessions enable row level security;
alter table public.downtime_events enable row level security;
alter table public.rcas enable row level security;
alter table public.flags enable row level security;
alter table public.notifications enable row level security;
revoke all on public.duty_sessions, public.downtime_events, public.rcas, public.flags, public.notifications from anon;

create policy duty_read on public.duty_sessions for select to authenticated using (true);
-- writes go through check_in / check_out

create policy downtime_read on public.downtime_events for select to authenticated using (true);
create policy downtime_insert on public.downtime_events for insert to authenticated
  with check (public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') and recorded_by_type = 'person');
-- Operators may update the events they logged while open; engineers and above any event.
create policy downtime_update on public.downtime_events for update to authenticated
  using (public.is_engineer_or_above() or (recorded_by_id = auth.uid() and status <> 'Closed'))
  with check (public.is_engineer_or_above() or status <> 'Closed');

create policy rcas_read on public.rcas for select to authenticated using (true);
create policy rcas_write on public.rcas for insert to authenticated with check (public.is_engineer_or_above());
create policy rcas_update on public.rcas for update to authenticated
  using (public.is_engineer_or_above()) with check (public.is_engineer_or_above());

create policy flags_read on public.flags for select to authenticated using (true);
-- writes go through acknowledge_flag / resolve_flag / run_flag_job

create policy notifications_read on public.notifications for select to authenticated
  using (recipient_id = auth.uid() or public.is_manager_or_admin());
