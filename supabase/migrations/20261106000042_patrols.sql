-- Area patrols (daily monitoring of the plant, especially remote areas): each patrol point has a QR label with a
-- secret code. The operator / engineer on duty scans it at the spot, answers the point's quick checks (and can add a
-- photo); that proves the visit. Each point needs N rounds per shift; a missed round is flagged after the shift.

create table public.patrol_points (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique check (length(trim(name)) >= 3),
  area             public.area_code not null,
  location         text,
  asset_ids        uuid[] not null default '{}',
  checks           text[] not null default '{"No leaks (water, steam, air, oil)", "No abnormal noise, vibration or smell", "Area clean, safe and secure"}',
  rounds_per_shift int not null default 1 check (rounds_per_shift between 1 and 12),
  code_hash        text,
  code_issued_at   timestamptz,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
select public.enable_audit('public.patrol_points', false);

create table public.patrol_visits (
  id               uuid primary key default gen_random_uuid(),
  point_id         uuid not null references public.patrol_points (id),
  shift_date       date not null,
  shift            text not null check (shift in ('day', 'night')),
  answers          jsonb not null default '{}',
  issues           int not null default 0,
  note             text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false
);
create index patrol_visits_shift_idx on public.patrol_visits (shift_date, shift, point_id);
create trigger patrol_visits_stamp before insert on public.patrol_visits for each row execute function public.stamp_recorded();
select public.enable_audit('public.patrol_visits', true);

alter table public.attachments drop constraint attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check check (entity_type in (
  'downtime', 'followup', 'pm_completion', 'pm_affirmation', 'cleaning', 'rca', 'asset', 'water_result', 'calibration',
  'instrument', 'job_request', 'external_report', 'training', 'outage', 'patrol_visit'));

create or replace function public.issue_patrol_code(p_point uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare k text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.has_role('admin', 'section_manager', 'shift_manager') then
    raise exception 'Only managers can issue patrol codes.' using errcode = 'P0001';
  end if;
  perform public.set_change_reason('Patrol code issued');
  update patrol_points set code_hash = encode(sha256(convert_to(k, 'UTF8')), 'hex'), code_issued_at = now() where id = p_point;
  if not found then raise exception 'Patrol point not found.' using errcode = 'P0001'; end if;
  return k;
end;
$$;
revoke execute on function public.issue_patrol_code(uuid) from public, anon;

-- Record a visit: only with the point's current code (i.e. standing at the label). Answers: {"<check>": "ok" | "issue"}.
create or replace function public.record_patrol_visit(p_point uuid, p_code text, p_answers jsonb, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare pt public.patrol_points; cs record; n_issue int; v uuid;
begin
  if not public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') then
    raise exception 'Your role cannot record patrol visits.' using errcode = 'P0001';
  end if;
  select * into pt from patrol_points where id = p_point and active;
  if pt.id is null then raise exception 'Patrol point not found.' using errcode = 'P0001'; end if;
  if pt.code_hash is null or pt.code_hash <> encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex') then
    raise exception 'This QR code is not valid any more. Scan the label at the point (or ask for a new label).' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(pt.checks) c where coalesce(p_answers->>c, '') not in ('ok', 'issue')) then
    raise exception 'Answer every check (OK or Issue).' using errcode = 'P0001';
  end if;
  select count(*) into n_issue from unnest(pt.checks) c where p_answers->>c = 'issue';
  if n_issue > 0 and coalesce(length(trim(p_note)), 0) < 5 then
    raise exception 'Describe the issue you found (5+ characters).' using errcode = 'P0001';
  end if;
  select * into cs from public.current_shift();
  insert into patrol_visits (point_id, shift_date, shift, answers, issues, note, recorded_by_type, reading_for)
  values (p_point, cs.shift_date, cs.shift, p_answers, n_issue, nullif(trim(p_note), ''), 'person', now())
  returning id into v;
  if n_issue > 0 then
    insert into flags (ref_key, kind, severity, area, title, detail, due_at)
    values ('patrol-issue:' || v, 'patrol_issue', 'warning', pt.area, format('Patrol issue at %s', pt.name), p_note, now())
    on conflict (ref_key) do nothing;
  end if;
  return v;
end;
$$;
revoke execute on function public.record_patrol_visit(uuid, text, jsonb, text) from public, anon;

alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'reading_early', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue',
  'pm_overdue', 'pm_followup', 'amc_past_due', 'water_alert', 'water_action', 'calibration_due',
  'followup_overdue', 'hours_service_due', 'training_unconfirmed', 'patrol_missed', 'patrol_issue'));

-- After each shift ends (+30 min grace), flag points with fewer visits than required. Only points that had a code
-- before the shift started are monitored (a new point starts being checked from its first full shift).
create or replace function public.run_patrol_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  with shifts as (
    select d::date as shift_date, s.shift,
           public.lagos_ts(d::date, case s.shift when 'day' then time '07:00' else time '19:00' end) as starts
      from generate_series(public.log_date_of(now()) - 2, public.log_date_of(now()), interval '1 day') d
      cross join (values ('day'), ('night')) s(shift)
  )
  insert into flags (ref_key, kind, severity, area, title, detail, due_at)
  select 'patrol:' || p.id || ':' || sh.shift_date || ':' || sh.shift, 'patrol_missed', 'warning', p.area,
         format('Patrol missed: %s (%s shift %s)', p.name, sh.shift, sh.shift_date),
         format('%s of %s round(s) done', coalesce(v.n, 0), p.rounds_per_shift), sh.starts + interval '12 hours'
    from patrol_points p
    cross join shifts sh
    left join lateral (select count(*) as n from patrol_visits pv
                        where pv.point_id = p.id and pv.shift_date = sh.shift_date and pv.shift = sh.shift and pv.voided_at is null) v on true
   where p.active and p.code_issued_at is not null and p.code_issued_at < sh.starts
     and now() > sh.starts + interval '12 hours 30 minutes'
     and coalesce(v.n, 0) < p.rounds_per_shift
  on conflict (ref_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.run_patrol_flags() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_ops_flags(); select public.run_training_flags(); select public.run_patrol_flags(); select public.run_deck_schedules(); select public.run_flag_job()');
  end if;
end $$;

alter table public.patrol_points enable row level security;
alter table public.patrol_visits enable row level security;
revoke all on public.patrol_points, public.patrol_visits from anon;
-- the code hash never leaves the database
revoke select on public.patrol_points from authenticated;
grant select (id, name, area, location, asset_ids, checks, rounds_per_shift, code_issued_at, active, created_at)
  on public.patrol_points to authenticated;
create policy patrol_points_read on public.patrol_points for select to authenticated using (public.is_active_user());
create policy patrol_points_write on public.patrol_points for all to authenticated
  using (public.has_role('admin', 'section_manager', 'shift_manager')) with check (public.has_role('admin', 'section_manager', 'shift_manager'));
create policy patrol_visits_read on public.patrol_visits for select to authenticated using (public.is_active_user());
-- visits are recorded through record_patrol_visit
