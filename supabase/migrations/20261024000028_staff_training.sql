-- Staff directory (Utility_Staff_List.xlsx) and training tracker (Training_Needs_for_Utility_Section_FY2026.xlsx).
-- Staff need not have a login: training, KPIs and competency can be tracked for everyone in the section.
-- When an admin pre-registers a staff member's email and role, their "Request access" sign-up is approved automatically.

create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  staff_id    text not null unique,
  surname     text not null,
  first_name  text not null,
  full_name   text generated always as (first_name || ' ' || surname) stored,
  band        int,
  team        text,
  job_title   text,
  area        public.area_code,
  email       text unique,
  phone       text,
  whatsapp    text,
  app_role    public.app_role,
  default_shift text check (default_shift in ('day', 'night')),
  profile_id  uuid unique references public.profiles (id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column public.staff.app_role is 'Role given automatically when this person signs up with the email above (pre-approved by an admin).';
create trigger staff_touch before update on public.staff for each row execute function public.touch_updated_at();
select public.enable_audit('public.staff', false);

-- Keep emails comparable.
create or replace function public.staff_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := nullif(lower(trim(new.email)), '');
  return new;
end;
$$;
create trigger staff_before_write before insert or update on public.staff for each row execute function public.staff_before_write();

-- Sign-up: bootstrap admins as before; a pre-registered staff email gets its role and is activated and linked.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_bootstrap boolean;
  st public.staff;
begin
  select coalesce(lower(new.email) in (select lower(jsonb_array_elements_text(value)) from public.app_settings
                                       where key = 'bootstrap_admin_emails'), false)
    into is_bootstrap;
  select * into st from public.staff where email = lower(new.email) and active and profile_id is null;

  insert into public.profiles (id, full_name, email, role, active, staff_id, phone, whatsapp, areas, default_shift)
  values (
    new.id,
    coalesce(st.full_name, new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    case when is_bootstrap then 'admin'::public.app_role
         when st.app_role is not null then st.app_role
         else coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'viewer')::public.app_role end,
    is_bootstrap or st.app_role is not null or coalesce((new.raw_app_meta_data ->> 'active')::boolean, false),
    st.staff_id, st.phone, st.whatsapp,
    case when st.area is not null then array[st.area] else '{U1,U2}'::public.area_code[] end,
    st.default_shift
  )
  on conflict (id) do nothing;
  if st.id is not null then
    update public.staff set profile_id = new.id where id = st.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Link existing logins to staff rows by staff ID or email (admin action; safe to re-run).
create or replace function public.link_staff_profiles()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if auth.uid() is not null and not public.has_role('admin', 'section_manager') then
    raise exception 'Only an admin can link staff.' using errcode = 'P0001';
  end if;
  update public.staff s set profile_id = p.id
    from public.profiles p
   where s.profile_id is null
     and (p.staff_id = s.staff_id or (s.email is not null and lower(p.email) = s.email))
     and not exists (select 1 from public.staff x where x.profile_id = p.id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.link_staff_profiles() from public, anon;

-- ---------------------------------------------------------------- Training
create table public.training_courses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null unique,
  provider    text,
  duration    text,
  category    text,
  active      boolean not null default true
);
select public.enable_audit('public.training_courses', false);

create table public.training_plans (
  id               uuid primary key default gen_random_uuid(),
  staff_ref        uuid not null references public.staff (id),
  course_id        uuid not null references public.training_courses (id),
  fy               text not null,
  planned_text     text,
  planned_start    date,
  planned_end      date,
  provider         text,
  status           text not null default 'planned'
                     check (status in ('planned', 'completed', 'not_attended', 'postponed', 'cancelled')),
  completed_on     date,
  outcome_note     text,
  confirmed_by     uuid references auth.users (id),
  confirmed_at     timestamptz,
  import_key       text unique,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false,
  check (planned_end is null or planned_start is null or planned_end >= planned_start),
  check (status <> 'completed' or completed_on is not null),
  check (status not in ('not_attended', 'postponed', 'cancelled') or coalesce(trim(outcome_note), '') <> '')
);
create index training_plans_staff_idx on public.training_plans (staff_ref);
create trigger training_plans_stamp before insert on public.training_plans for each row execute function public.stamp_recorded();
create trigger training_plans_keep_stamp before update on public.training_plans for each row execute function public.keep_record_stamp();
select public.enable_audit('public.training_plans', false);

-- Tick a training as done (or record not attended / postponed / cancelled with a note).
create or replace function public.set_training_status(p_id uuid, p_status text, p_date date, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can update training records.' using errcode = 'P0001';
  end if;
  if p_status = 'completed' and (p_date is null or p_date > public.lagos_now()::date) then
    raise exception 'Enter the date the training was completed (not in the future).' using errcode = 'P0001';
  end if;
  if p_status in ('not_attended', 'postponed', 'cancelled') and coalesce(length(trim(p_note)), 0) < 3 then
    raise exception 'Add a note.' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(coalesce(nullif(trim(p_note), ''), 'Training ' || p_status));
  update public.training_plans
     set status = p_status, completed_on = case when p_status = 'completed' then p_date end,
         outcome_note = nullif(trim(p_note), ''), confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_id and voided_at is null;
  if not found then raise exception 'Training record not found.' using errcode = 'P0001'; end if;
end;
$$;
revoke execute on function public.set_training_status(uuid, text, date, text) from public, anon;

create or replace function public.void_training_plan(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager_or_admin() then
    raise exception 'Only managers can remove a training record.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.training_plans set voided_at = now(), void_reason = p_reason where id = p_id and voided_at is null;
end;
$$;
revoke execute on function public.void_training_plan(uuid, text) from public, anon;

-- {"staff": [{staff_id, surname, first_name, band, team}], "courses": [{title, provider, duration}],
--  "plans": [{staff_id, course, when, start, end, provider, fy}]}. Re-running updates names/bands, never statuses.
create or replace function public.load_staff_training(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lg uuid; ns int; nc int; np int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can import staff and training.' using errcode = 'P0001';
  end if;
  insert into public.loggers (name, description) values ('EXCEL-IMPORT', 'Rows imported from the section''s Excel trackers')
  on conflict (name) do nothing;
  select id into lg from public.loggers where name = 'EXCEL-IMPORT';

  insert into public.staff (staff_id, surname, first_name, band, team)
  select x->>'staff_id', x->>'surname', x->>'first_name', (x->>'band')::int, x->>'team'
    from jsonb_array_elements(p->'staff') x
  on conflict (staff_id) do update set surname = excluded.surname, first_name = excluded.first_name,
                                       band = excluded.band, team = excluded.team;
  get diagnostics ns = row_count;

  insert into public.training_courses (title, provider, duration)
  select x->>'title', x->>'provider', x->>'duration' from jsonb_array_elements(p->'courses') x
  on conflict (title) do update set provider = excluded.provider, duration = excluded.duration;
  get diagnostics nc = row_count;

  insert into public.training_plans (staff_ref, course_id, fy, planned_text, planned_start, planned_end, provider,
                                     import_key, recorded_by_type, recorded_by_id, reading_for)
  select s.id, c.id, x->>'fy', x->>'when', (x->>'start')::date, (x->>'end')::date, x->>'provider',
         'xls:training:' || (x->>'fy') || ':' || (x->>'staff_id') || ':' || md5(x->>'course'),
         'logger', lg, (x->>'start')::date
    from jsonb_array_elements(p->'plans') x
    join public.staff s on s.staff_id = x->>'staff_id'
    join public.training_courses c on c.title = x->>'course'
  on conflict (import_key) do update set planned_text = excluded.planned_text, planned_start = excluded.planned_start,
                                         planned_end = excluded.planned_end, provider = excluded.provider;
  get diagnostics np = row_count;
  perform public.link_staff_profiles();
  return jsonb_build_object('staff', ns, 'courses', nc, 'plans', np);
end;
$$;
revoke execute on function public.load_staff_training(jsonb) from public, anon, authenticated;

alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'reading_early', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue',
  'pm_overdue', 'pm_followup', 'amc_past_due', 'water_alert', 'water_action', 'calibration_due',
  'followup_overdue', 'hours_service_due', 'training_unconfirmed'));

-- Training whose planned end date has passed without being ticked (one flag per plan).
create or replace function public.run_training_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into public.flags (ref_key, kind, severity, title, detail, due_at, is_demo)
  select 'trn:' || t.id, 'training_unconfirmed', 'info',
         format('Training not confirmed: %s – %s', s.full_name, c.title),
         format('Planned %s (%s). Tick it done, or record not attended / postponed.', t.planned_text, t.provider),
         public.lagos_ts(t.planned_end, time '23:59'), t.is_demo
    from public.training_plans t join public.staff s on s.id = t.staff_ref join public.training_courses c on c.id = t.course_id
   where t.status = 'planned' and t.voided_at is null and t.planned_end < public.lagos_now()::date - 2
  on conflict (ref_key) do nothing;
  get diagnostics n = row_count;
  update public.flags f set resolved_at = now(), resolution_note = 'Training updated'
   where f.kind = 'training_unconfirmed' and f.resolved_at is null
     and exists (select 1 from public.training_plans t where 'trn:' || t.id = f.ref_key and (t.status <> 'planned' or t.voided_at is not null));
  return n;
end;
$$;
revoke execute on function public.run_training_flags() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_ops_flags(); select public.run_training_flags(); select public.run_flag_job()');
  end if;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.staff enable row level security;
alter table public.training_courses enable row level security;
alter table public.training_plans enable row level security;
revoke all on public.staff, public.training_courses, public.training_plans from anon;

create policy staff_read on public.staff for select to authenticated using (true);
create policy staff_write on public.staff for all to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));
create policy training_courses_read on public.training_courses for select to authenticated using (true);
create policy training_courses_write on public.training_courses for all to authenticated
  using (public.is_engineer_or_above()) with check (public.is_engineer_or_above());
create policy training_plans_read on public.training_plans for select to authenticated using (true);
create policy training_plans_insert on public.training_plans for insert to authenticated
  with check (public.is_engineer_or_above() and recorded_by_type = 'person' and not is_demo);
-- status changes go through set_training_status
