-- Verifying PM work (owner, 2026-11-12):
--  1. Machine QR scan: each machine can get a secret scan code (printed on its label; only a hash is stored). For PMs from
--     monthly up, "Completed" needs a scan of that machine's label by the same person within pm_scan_window_hours
--     (default 12 h) once the machine has a scan code. Completions record site_verified.
--  2. Photos for critical equipment: monthly-and-longer PMs completed on criticality A machines need a photo; a flag is
--     raised when none is attached within pm_photo_hours (default 24 h).
--  3. Engineer spot-checks: each week the app picks pm_spot_checks_per_area (default 3) random "Completed – no issue
--     found" PMs per area from the last 7 days. An engineer (not the one who did it) checks on site: Confirmed, or Not
--     satisfactory (the PM result is voided so the PM is open again, and a follow-up flag is raised).
--  4. Early failure after PM: a breakdown (or urgent CBM stop) within pm_early_failure_days (default 7) of a "Completed –
--     no issue found" PM on the same machine raises a flag for review.

insert into public.app_settings (key, value, description) values
  ('pm_scan_required', 'true'::jsonb, 'PMs from monthly up need a scan of the machine''s QR label (once the machine has a scan code).'),
  ('pm_scan_window_hours', '12'::jsonb, 'How long a machine scan stays valid for completing its PM (hours).'),
  ('pm_photo_hours', '24'::jsonb, 'Hours allowed to attach the photo for a critical-equipment PM before it is flagged.'),
  ('pm_spot_checks_per_area', '3'::jsonb, 'Completed PMs picked at random per area each week for an engineer to check on site.'),
  ('pm_early_failure_days', '7'::jsonb, 'A breakdown this many days after a "no issue found" PM on the same machine is flagged.')
on conflict (key) do nothing;

-- 1. Machine scan codes and scans
create table public.asset_scan_codes (
  asset_id   uuid primary key references public.assets (id),
  code_hash  text not null,
  issued_at  timestamptz not null default now(),
  issued_by  uuid references auth.users (id)
);
alter table public.asset_scan_codes enable row level security;
revoke all on public.asset_scan_codes from anon, authenticated;   -- only through the functions below

create table public.asset_scans (
  id               uuid primary key default gen_random_uuid(),
  asset_id         uuid not null references public.assets (id),
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  is_demo          boolean not null default false
);
create index asset_scans_idx on public.asset_scans (asset_id, recorded_by_id, recorded_at desc);
create trigger asset_scans_stamp before insert on public.asset_scans for each row execute function public.stamp_recorded();
alter table public.asset_scans enable row level security;
revoke all on public.asset_scans from anon;
create policy asset_scans_read on public.asset_scans for select to authenticated using (public.is_active_user());

-- New codes for the given machines (old labels stop working). Returns the codes once, for printing.
create or replace function public.issue_asset_scan_codes(p_assets uuid[])
returns table (asset_id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_role('admin', 'section_manager', 'shift_manager') then
    raise exception 'Only managers can issue machine scan codes.' using errcode = 'P0001';
  end if;
  return query
  with k as (select a.id, replace(gen_random_uuid()::text, '-', '') as c from assets a where a.id = any (p_assets) and a.status <> 'retired'),
  up as (
    insert into asset_scan_codes (asset_id, code_hash, issued_at, issued_by)
    select k.id, encode(sha256(convert_to(k.c, 'UTF8')), 'hex'), now(), auth.uid() from k
    on conflict (asset_id) do update set code_hash = excluded.code_hash, issued_at = now(), issued_by = auth.uid()
    returning asset_scan_codes.asset_id
  )
  select k.id, k.c from k join up on up.asset_id = k.id;
end;
$$;
revoke execute on function public.issue_asset_scan_codes(uuid[]) from public, anon;

create or replace function public.asset_scan_codes_status()
returns table (asset_id uuid, issued_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$ select asset_id, issued_at from asset_scan_codes where public.is_active_user() $$;
revoke execute on function public.asset_scan_codes_status() from public, anon;

-- Record a scan from the label link (code = asset code shown on the label, secret = from the QR).
create or replace function public.record_asset_scan(p_code text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare a public.assets; ok boolean; v uuid;
begin
  if not public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') then
    raise exception 'Your role cannot record machine scans.' using errcode = 'P0001';
  end if;
  select * into a from assets where code = p_code;
  if a.id is null then raise exception 'Machine not found.' using errcode = 'P0001'; end if;
  select exists (select 1 from asset_scan_codes s where s.asset_id = a.id and s.code_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')) into ok;
  if not ok then raise exception 'This label is not valid any more. Ask for a new label for %.', a.code using errcode = 'P0001'; end if;
  insert into asset_scans (asset_id, recorded_by_type, reading_for) values (a.id, 'person', now()) returning id into v;
  return v;
end;
$$;
revoke execute on function public.record_asset_scan(text, text) from public, anon;

alter table public.pm_completions add column if not exists site_verified boolean not null default false;

create or replace function public.pm_completions_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.pm_tasks;
  a public.assets;
  has_code boolean;
begin
  select * into t from pm_tasks where id = new.task_id;
  if tg_op = 'INSERT' then
    if t.id is null or not t.active then
      raise exception 'Unknown or inactive PM task.' using errcode = 'P0001';
    end if;
    new.period_start := public.pm_period_start(t.frequency, coalesce(new.period_start, public.log_date_of(now())));
    if new.period_start > public.log_date_of(now()) then
      raise exception 'You cannot record PM for a future period.' using errcode = 'P0001';
    end if;
    if not new.is_demo then
      new.reading_for := now();
      if t.asset_id is not null then
        new.site_verified := exists (select 1 from asset_scans s
                                      where s.asset_id = t.asset_id and s.recorded_by_id = coalesce(auth.uid(), new.recorded_by_id)
                                        and s.recorded_at > now() - make_interval(hours => public.setting_num('pm_scan_window_hours', 12)::int));
        select exists (select 1 from asset_scan_codes c where c.asset_id = t.asset_id) into has_code;
        if new.result in ('done_ok', 'done_not_ok') and t.frequency in ('monthly', 'quarterly', 'bi_annual', 'annual')
           and has_code and not new.site_verified
           and coalesce((select (value #>> '{}')::boolean from app_settings where key = 'pm_scan_required'), true) then
          select * into a from assets where id = t.asset_id;
          raise exception 'Scan the QR label on % first: PMs from monthly up are completed at the machine.', a.code using errcode = 'P0001';
        end if;
      end if;
    end if;
  else
    if new.task_id <> old.task_id or new.period_start <> old.period_start or new.result <> old.result
       or new.note is distinct from old.note or new.recorded_by_id is distinct from old.recorded_by_id
       or new.recorded_at <> old.recorded_at then
      raise exception 'A submitted PM result cannot be changed. Void it with a reason and enter it again.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.pm_completions_before_write() from public, anon, authenticated;

-- 3. Spot-checks
create table public.pm_spot_checks (
  id            uuid primary key default gen_random_uuid(),
  completion_id uuid not null unique references public.pm_completions (id),
  week_start    date not null,
  area          public.area_code,
  result        text check (result in ('confirmed', 'not_satisfactory')),
  note          text,
  checked_by    uuid references auth.users (id),
  checked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index pm_spot_checks_week_idx on public.pm_spot_checks (week_start, area);
select public.enable_audit('public.pm_spot_checks', false);
alter table public.pm_spot_checks enable row level security;
revoke all on public.pm_spot_checks from anon;
create policy pm_spot_checks_read on public.pm_spot_checks for select to authenticated using (public.is_active_user());

create or replace function public.run_pm_spot_checks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare wk date := public.pm_period_start('weekly', public.log_date_of(now())); n int := 0; m int; ar public.area_code;
        per int := public.setting_num('pm_spot_checks_per_area', 3)::int;
begin
  foreach ar in array array['U1', 'U2']::public.area_code[] loop
    continue when exists (select 1 from pm_spot_checks where week_start = wk and area = ar);
    insert into pm_spot_checks (completion_id, week_start, area)
    select c.id, wk, ar
      from pm_completions c join pm_tasks t on t.id = c.task_id
     where c.result = 'done_ok' and c.voided_at is null and not c.is_demo and t.area = ar
       and c.recorded_at > now() - interval '7 days'
       and not exists (select 1 from pm_spot_checks x where x.completion_id = c.id)
     order by random() limit per;
    get diagnostics m = row_count;
    n := n + m;
  end loop;
  -- last week's checks not done → flag
  insert into flags (ref_key, kind, severity, area, title, detail, due_at)
  select 'pmsc:' || s.week_start || ':' || s.area, 'pm_spot_check', 'warning', s.area,
         format('PM spot-checks not done (week of %s, %s)', to_char(s.week_start, 'DD Mon'), s.area),
         format('%s of the PMs picked for checking were not checked on site.', count(*)), s.week_start + 7
    from pm_spot_checks s
   where s.result is null and s.week_start < wk
   group by s.week_start, s.area
  on conflict (ref_key) do nothing;
  return n;
end;
$$;
revoke execute on function public.run_pm_spot_checks() from public, anon, authenticated;

create or replace function public.check_pm_spot(p_id uuid, p_result text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s public.pm_spot_checks; c public.pm_completions; t public.pm_tasks;
begin
  if not public.is_engineer_or_above() then raise exception 'Only engineers and managers do PM spot-checks.' using errcode = 'P0001'; end if;
  select * into s from pm_spot_checks where id = p_id;
  if s.id is null or s.result is not null then raise exception 'This spot-check is already done.' using errcode = 'P0001'; end if;
  select * into c from pm_completions where id = s.completion_id;
  if c.recorded_by_id = auth.uid() then raise exception 'Someone else must check your own PM work.' using errcode = 'P0001'; end if;
  if p_result not in ('confirmed', 'not_satisfactory') then raise exception 'Choose Confirmed or Not satisfactory.' using errcode = 'P0001'; end if;
  if p_result = 'not_satisfactory' and coalesce(length(trim(p_note)), 0) < 5 then
    raise exception 'Say what was not satisfactory (5+ characters).' using errcode = 'P0001';
  end if;
  update pm_spot_checks set result = p_result, note = nullif(trim(p_note), ''), checked_by = auth.uid(), checked_at = now() where id = p_id;
  if p_result = 'not_satisfactory' and c.voided_at is null then
    select * into t from pm_tasks where id = c.task_id;
    perform public.set_change_reason('Spot-check not satisfactory: ' || trim(p_note));
    update pm_completions set voided_at = now(), voided_by = auth.uid(), void_reason = 'Spot-check not satisfactory: ' || trim(p_note) where id = c.id;
    insert into flags (ref_key, kind, severity, area, asset_id, pm_task_id, title, detail, due_at)
    values ('pms:' || s.id, 'pm_followup', 'warning', t.area, t.asset_id, t.id,
            format('PM failed spot-check: %s (%s)', t.equipment_as_written, replace(t.frequency, '_', '-')), trim(p_note), now())
    on conflict (ref_key) do nothing;
  end if;
  update flags set resolved_at = now(), resolution_note = 'Spot-checks done'
   where ref_key = 'pmsc:' || s.week_start || ':' || s.area and resolved_at is null
     and not exists (select 1 from pm_spot_checks x where x.week_start = s.week_start and x.area = s.area and x.result is null);
end;
$$;
revoke execute on function public.check_pm_spot(uuid, text, text) from public, anon;

-- 2 and 4: photo missing for critical equipment, early failure after PM
create or replace function public.run_pm_verification_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int; m int;
begin
  insert into flags (ref_key, kind, severity, area, asset_id, pm_task_id, title, detail, due_at)
  select 'pmph:' || c.id, 'pm_photo_missing', 'warning', t.area, t.asset_id, t.id,
         format('Photo missing for critical PM: %s (%s)', t.equipment_as_written, replace(t.frequency, '_', '-')),
         'Attach a photo of the work on the PM page.', c.recorded_at + make_interval(hours => public.setting_num('pm_photo_hours', 24)::int)
    from pm_completions c join pm_tasks t on t.id = c.task_id join assets a on a.id = t.asset_id
   where c.voided_at is null and not c.is_demo and c.result in ('done_ok', 'done_not_ok') and a.criticality = 'A'
     and t.frequency in ('monthly', 'quarterly', 'bi_annual', 'annual')
     and c.recorded_at < now() - make_interval(hours => public.setting_num('pm_photo_hours', 24)::int)
     and c.recorded_at > now() - interval '60 days'
     and not exists (select 1 from attachments x where x.entity_type = 'pm_completion' and x.entity_id = c.id)
  on conflict (ref_key) do nothing;
  get diagnostics n = row_count;
  update flags f set resolved_at = now(), resolution_note = 'Photo attached'
   where f.kind = 'pm_photo_missing' and f.resolved_at is null
     and exists (select 1 from attachments x where x.entity_type = 'pm_completion' and x.entity_id::text = substr(f.ref_key, 6));

  insert into flags (ref_key, kind, severity, area, asset_id, downtime_id, pm_task_id, title, detail, due_at)
  select distinct on (e.id) 'pmef:' || e.id, 'pm_early_failure', 'warning', e.area, e.asset_id, e.id, t.id,
         format('Breakdown %s days after a "no issue found" PM: %s', greatest(1, (e.start_at::date - c.recorded_at::date)), a.code),
         format('%s (%s) on %s; PM "%s" recorded %s.', e.failure_mode, e.event_no, to_char(e.start_at, 'DD Mon'), t.equipment_as_written,
                to_char(c.recorded_at, 'DD Mon')), e.start_at
    from downtime_events e
    join assets a on a.id = e.asset_id
    join pm_tasks t on t.asset_id = e.asset_id
    join pm_completions c on c.task_id = t.id and c.result = 'done_ok' and c.voided_at is null and not c.is_demo
   where e.voided_at is null and not e.is_demo and e.start_at > now() - interval '30 days'
     and (e.downtime_type = 'Unplanned Breakdown' or (e.downtime_type = 'Condition-Based Maintenance (CBM)' and e.immediate_stop))
     and c.recorded_at < e.start_at and c.recorded_at > e.start_at - make_interval(days => public.setting_num('pm_early_failure_days', 7)::int)
   order by e.id, c.recorded_at desc
  on conflict (ref_key) do nothing;
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke execute on function public.run_pm_verification_flags() from public, anon, authenticated;

alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'reading_early', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue',
  'pm_overdue', 'pm_followup', 'amc_past_due', 'water_alert', 'water_action', 'calibration_due',
  'followup_overdue', 'hours_service_due', 'training_unconfirmed', 'patrol_missed', 'patrol_issue',
  'handover_missing', 'handover_unack', 'pm_photo_missing', 'pm_spot_check', 'pm_early_failure'));

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_pm_verification_flags(); select public.run_pm_spot_checks(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_ops_flags(); select public.run_training_flags(); select public.run_patrol_flags(); select public.run_handover_flags(); select public.run_deck_schedules(); select public.run_flag_job()');
  end if;
end $$;
