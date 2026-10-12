-- Process water sampling plan (CHICQARG24) with results judged against specification and alert limit,
-- and the instrument calibration register with due dates.

-- ---------------------------------------------------------------- Water quality
create table public.water_tests (
  id             uuid primary key default gen_random_uuid(),
  sort           int not null,
  sampling_point text not null,
  sample_type    text not null,
  parameter      text not null,
  unit           text,
  volume         text,
  method         text,
  media          text,
  frequency      text not null check (frequency in ('weekly', 'fortnightly', 'monthly', 'quarterly', 'annual', 'conditional')),
  frequency_text text,
  incubation     text,
  spec_text      text,
  spec_min       numeric,
  spec_max       numeric,
  max_inclusive  boolean not null default true,
  alert_max      numeric,
  alert_text     text,
  action_text    text,
  is_text        boolean not null default false,
  needs_review   boolean not null default false,
  document_no    text not null default 'CHICQARG24',
  active         boolean not null default true,
  unique (sampling_point, parameter)
);
select public.enable_audit('public.water_tests', false);

-- ok = within spec and below alert; alert = within spec but at/above the alert limit; action = outside spec.
create or replace function public.water_status(t public.water_tests, v numeric)
returns text
language sql
immutable
as $$
  select case
    when v is null then 'info'
    when t.spec_min is not null and v < t.spec_min then 'action'
    when t.spec_max is not null and (v > t.spec_max or (not t.max_inclusive and v >= t.spec_max)) then 'action'
    when t.alert_max is not null and v >= t.alert_max then 'alert'
    when t.spec_min is null and t.spec_max is null then 'info'
    else 'ok' end
$$;

create table public.water_results (
  id               uuid primary key default gen_random_uuid(),
  test_id          uuid not null references public.water_tests (id),
  sampled_on       date not null,
  value_num        numeric,
  value_text       text,
  status           text not null default 'info' check (status in ('ok', 'alert', 'action', 'info')),
  comment          text,
  action_taken     text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false,
  check (value_num is not null or coalesce(trim(value_text), '') <> '')
);
create unique index water_results_one on public.water_results (test_id, sampled_on) where voided_at is null;
create index water_results_date_idx on public.water_results (sampled_on);

create or replace function public.water_results_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare t public.water_tests;
begin
  if tg_op = 'UPDATE' and (new.value_num is distinct from old.value_num or new.value_text is distinct from old.value_text
                           or new.sampled_on <> old.sampled_on or new.recorded_at <> old.recorded_at) then
    raise exception 'Void the result with a reason and enter it again.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    select * into t from water_tests where id = new.test_id;
    if t.id is null then raise exception 'Unknown water test.' using errcode = 'P0001'; end if;
    if new.sampled_on > public.lagos_now()::date then
      raise exception 'The sample date cannot be in the future.' using errcode = 'P0001';
    end if;
    new.status := public.water_status(t, new.value_num);
    if new.status in ('alert', 'action') and coalesce(trim(new.comment), '') = '' and coalesce(trim(new.action_taken), '') = '' then
      raise exception 'A result at or beyond the alert limit needs a comment or action.' using errcode = 'P0001';
    end if;
    if not new.is_demo then new.reading_for := public.lagos_ts(new.sampled_on, time '12:00'); end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.water_results_before_write() from public, anon, authenticated;
create trigger water_results_stamp before insert on public.water_results for each row execute function public.stamp_recorded();
create trigger water_results_before_write before insert or update on public.water_results
  for each row execute function public.water_results_before_write();
select public.enable_audit('public.water_results', true);

-- {"document_no": "...", "tests": [{sort, point, sample, param, unit, volume, method, media, freq, freq_text,
--   incubation, spec, min, max, max_incl, alert_max, alert, action, text, review}]}
create or replace function public.load_water_plan(p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can load the water plan.' using errcode = 'P0001';
  end if;
  insert into public.water_tests (sort, sampling_point, sample_type, parameter, unit, volume, method, media, frequency,
                                  frequency_text, incubation, spec_text, spec_min, spec_max, max_inclusive, alert_max,
                                  alert_text, action_text, is_text, needs_review, document_no)
  select (x->>'sort')::int, x->>'point', x->>'sample', x->>'param', x->>'unit', x->>'volume', x->>'method', x->>'media',
         x->>'freq', x->>'freq_text', x->>'incubation', x->>'spec', (x->>'min')::numeric, (x->>'max')::numeric,
         coalesce((x->>'max_incl')::boolean, true), (x->>'alert_max')::numeric, x->>'alert', x->>'action',
         coalesce((x->>'text')::boolean, false), coalesce((x->>'review')::boolean, false),
         coalesce(p->>'document_no', 'CHICQARG24')
    from jsonb_array_elements(p->'tests') x
  on conflict (sampling_point, parameter) do update
     set sort = excluded.sort, unit = excluded.unit, frequency = excluded.frequency, spec_text = excluded.spec_text,
         spec_min = excluded.spec_min, spec_max = excluded.spec_max, max_inclusive = excluded.max_inclusive,
         alert_max = excluded.alert_max, needs_review = excluded.needs_review;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.load_water_plan(jsonb) from public, anon, authenticated;

create or replace function public.void_water_result(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.water_results;
begin
  select * into r from public.water_results where id = p_id and voided_at is null;
  if r.id is null then raise exception 'Result not found.' using errcode = 'P0001'; end if;
  if not (r.recorded_by_id = auth.uid() or public.is_engineer_or_above()) then
    raise exception 'Only the person who entered it or an engineer can void it.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.water_results set voided_at = now(), void_reason = p_reason where id = p_id;
end;
$$;
revoke execute on function public.void_water_result(uuid, text) from public, anon;

-- ---------------------------------------------------------------- Calibration
create table public.instruments (
  id               uuid primary key default gen_random_uuid(),
  tag              text not null unique,
  description      text not null,
  instrument_type  text not null default 'Pressure gauge',
  asset_id         uuid references public.assets (id),
  area             public.area_code,
  location         text,
  range_text       text,
  interval_months  int not null default 12 check (interval_months between 1 and 120),
  last_calibrated  date,
  next_due         date generated always as ((last_calibrated + make_interval(months => interval_months))::date) stored,
  active           boolean not null default true,
  notes            text,
  is_demo          boolean not null default false
);
select public.enable_audit('public.instruments', false);

create table public.calibrations (
  id               uuid primary key default gen_random_uuid(),
  instrument_id    uuid not null references public.instruments (id),
  calibrated_on    date not null,
  result           text not null check (result in ('pass', 'adjusted', 'fail')),
  certificate_no   text,
  vendor           text,
  notes            text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false,
  check (result <> 'fail' or coalesce(trim(notes), '') <> '')
);

-- A calibration updates the instrument's last-calibrated date (latest non-void record wins).
create or replace function public.calibrations_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.instruments i
     set last_calibrated = (select max(c.calibrated_on) from public.calibrations c
                             where c.instrument_id = i.id and c.voided_at is null and c.result <> 'fail')
   where i.id = new.instrument_id;
  return null;
end;
$$;
revoke execute on function public.calibrations_after_write() from public, anon, authenticated;

create or replace function public.calibrations_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.calibrated_on > public.lagos_now()::date then
      raise exception 'The calibration date cannot be in the future.' using errcode = 'P0001';
    end if;
    if not new.is_demo then new.reading_for := public.lagos_ts(new.calibrated_on, time '12:00'); end if;
  elsif new.calibrated_on <> old.calibrated_on or new.result <> old.result or new.recorded_at <> old.recorded_at then
    raise exception 'Void the calibration with a reason and enter it again.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.calibrations_before_write() from public, anon, authenticated;
create trigger calibrations_stamp before insert on public.calibrations for each row execute function public.stamp_recorded();
create trigger calibrations_before_write before insert or update on public.calibrations
  for each row execute function public.calibrations_before_write();
create trigger calibrations_after_write after insert or update on public.calibrations
  for each row execute function public.calibrations_after_write();
select public.enable_audit('public.calibrations', true);

create or replace function public.void_calibration(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can void a calibration.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.calibrations set voided_at = now(), void_reason = p_reason where id = p_id and voided_at is null;
end;
$$;
revoke execute on function public.void_calibration(uuid, text) from public, anon;

insert into public.app_settings (key, value, description) values
  ('calibration_warn_days', '30'::jsonb, 'Days before an instrument''s calibration due date that a "due soon" flag is raised.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- RLS
alter table public.water_tests enable row level security;
alter table public.water_results enable row level security;
alter table public.instruments enable row level security;
alter table public.calibrations enable row level security;
revoke all on public.water_tests, public.water_results, public.instruments, public.calibrations from anon;

create policy water_tests_read on public.water_tests for select to authenticated using (true);
create policy water_tests_update on public.water_tests for update to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));
create policy water_results_read on public.water_results for select to authenticated using (true);
create policy water_results_insert on public.water_results for insert to authenticated
  with check (public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
              and recorded_by_type = 'person' and not is_demo);

create policy instruments_read on public.instruments for select to authenticated using (true);
create policy instruments_insert on public.instruments for insert to authenticated
  with check (public.is_engineer_or_above() and not is_demo);
create policy instruments_update on public.instruments for update to authenticated
  using (public.is_engineer_or_above()) with check (public.is_engineer_or_above());
create policy calibrations_read on public.calibrations for select to authenticated using (true);
create policy calibrations_insert on public.calibrations for insert to authenticated
  with check (public.is_engineer_or_above() and recorded_by_type = 'person' and not is_demo);
