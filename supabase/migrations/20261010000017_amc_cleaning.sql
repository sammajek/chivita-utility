-- AMC tracker (Utility Annual Maintenance Contract sheet: Planned / Done / Past Due per month)
-- and the cleaning roster (CHI/ENG/UTI/CLN/001: Mon–Fri zones, Done / Not Done, manager sign-off).

-- ---------------------------------------------------------------- AMC
create table public.amc_contracts (
  id          uuid primary key default gen_random_uuid(),
  sn          int,
  description text not null unique,
  vendor      text not null,
  area        public.area_code,
  asset_ids   uuid[] not null default '{}',
  start_date  date,
  end_date    date,
  notes       text,
  active      boolean not null default true
);

-- Months in which a vendor visit is planned (first day of the month).
create table public.amc_schedule (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.amc_contracts (id),
  month       date not null check (extract(day from month) = 1),
  planned     boolean not null default true,
  updated_by  uuid references auth.users (id),
  updated_at  timestamptz not null default now(),
  unique (contract_id, month)
);

create table public.amc_visits (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references public.amc_contracts (id),
  month            date not null check (extract(day from month) = 1),
  visit_date       date not null,
  vendor_rep       text,
  findings         text,
  recommendations  text,
  cost_ngn         numeric check (cost_ngn is null or cost_ngn >= 0),
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false,
  check (date_trunc('month', visit_date)::date = month)
);
create unique index amc_visits_one_per_month on public.amc_visits (contract_id, month) where voided_at is null;

create or replace function public.amc_visits_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.month := date_trunc('month', new.visit_date)::date;
    if new.visit_date > public.lagos_now()::date then
      raise exception 'The visit date cannot be in the future.' using errcode = 'P0001';
    end if;
    if not new.is_demo then new.reading_for := public.lagos_ts(new.visit_date, time '12:00'); end if;
  elsif new.contract_id <> old.contract_id or new.visit_date <> old.visit_date or new.recorded_at <> old.recorded_at then
    raise exception 'Void the visit with a reason and enter it again.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.amc_visits_before_write() from public, anon, authenticated;
create trigger amc_visits_stamp before insert on public.amc_visits for each row execute function public.stamp_recorded();
create trigger amc_visits_before_write before insert or update on public.amc_visits
  for each row execute function public.amc_visits_before_write();
select public.enable_audit('public.amc_visits', true);
select public.enable_audit('public.amc_schedule', false);
select public.enable_audit('public.amc_contracts', false);

create or replace function public.set_amc_plan(p_contract uuid, p_month date, p_planned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can plan AMC visits.' using errcode = 'P0001';
  end if;
  insert into public.amc_schedule (contract_id, month, planned, updated_by)
  values (p_contract, date_trunc('month', p_month)::date, p_planned, auth.uid())
  on conflict (contract_id, month) do update set planned = excluded.planned, updated_by = auth.uid(), updated_at = now();
end;
$$;
revoke execute on function public.set_amc_plan(uuid, date, boolean) from public, anon;

create or replace function public.void_amc_visit(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can void an AMC visit.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.amc_visits set voided_at = now(), void_reason = p_reason where id = p_id and voided_at is null;
end;
$$;
revoke execute on function public.void_amc_visit(uuid, text) from public, anon;

insert into public.amc_contracts (sn, description, vendor, area) values
  (1, 'TRANE CHILLER MAINTENANCE', 'ELEKTRINT', 'U1'),
  (2, 'SOFTENER PLANT MAINTENANCE, BOILER FEED WATER ANALYSIS & MONITORING', 'CLEARTEK', 'U1'),
  (3, 'VAM CHILLER MAINTENANCE & MONITORING', 'THERMAX', 'U1'),
  (4, 'AIR CONDITIONERS MAINTENANCE ACROSS FACTORY', 'OBA & SONS', null)
on conflict (description) do nothing;
update public.amc_contracts set asset_ids = array(select id from public.assets where code like 'CHT-%' order by code)
 where sn = 1;
update public.amc_contracts set asset_ids = array(select id from public.assets where code in ('SOF-01')) where sn = 2;
update public.amc_contracts set asset_ids = array(select id from public.assets where code like 'CHV-%' order by code)
 where sn = 3;

-- ---------------------------------------------------------------- Cleaning roster
create table public.cleaning_zones (
  id          serial primary key,
  day_of_week smallint not null unique check (day_of_week between 1 and 7),  -- 1 = Monday
  area        public.area_code not null,
  name        text not null
);
create table public.cleaning_activities (
  id   serial primary key,
  sort smallint not null unique,
  name text not null
);
insert into public.cleaning_zones (day_of_week, area, name) values
  (1, 'U1', 'Utility 1 Equipment & Open Area (Boilers, Chillers, Water Treatment Tanks, Compressor 5,6,8,9, VAM 1 & 2)'),
  (2, 'U1', 'Utility 1 Equipment & Open Area (WTP Pumps, WTP Pressure Filters, Compressor 2 - 7, Air Dryers)'),
  (3, 'U2', 'Utility 2 (All Areas, Cooling Tower Platform), Utility 1 Cooling Tower Equipment'),
  (4, 'U2', 'Utility 2 Equipment (Compressors, Chillers)'),
  (5, 'U1', 'Utility 1 Area (Compressor 2 - 7, Air Dryers, Chilled Water Tank & Pumps, Feed Water Tank & Softener, Cooling Tower Platform)')
on conflict (day_of_week) do nothing;
insert into public.cleaning_activities (sort, name) values
  (1, 'Washing and drying of floor area; removal of idle and waste objects around area'),
  (2, 'Removal of cobwebs on equipment'),
  (3, 'Cleaning of equipment')
on conflict (sort) do nothing;

-- One result per zone/activity per week (weeks start Sunday, like the PM log).
create table public.cleaning_checks (
  id               uuid primary key default gen_random_uuid(),
  week_start       date not null check (extract(dow from week_start) = 0),
  zone_id          int not null references public.cleaning_zones (id),
  activity_id      int not null references public.cleaning_activities (id),
  result           text not null check (result in ('done', 'not_done')),
  note             text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false,
  check (result = 'done' or coalesce(trim(note), '') <> '')
);
create unique index cleaning_checks_one on public.cleaning_checks (week_start, zone_id, activity_id) where voided_at is null;

create table public.cleaning_signoffs (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null check (extract(dow from week_start) = 0),
  signed_by   uuid not null references auth.users (id) default auth.uid(),
  signed_at   timestamptz not null default now(),
  comment     text,
  is_demo     boolean not null default false,
  unique (week_start)
);

create or replace function public.cleaning_checks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.week_start := public.pm_period_start('weekly', new.week_start);
    if new.week_start > public.log_date_of(now()) then
      raise exception 'You cannot record cleaning for a future week.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.cleaning_signoffs where week_start = new.week_start) then
      raise exception 'This week has been signed off by the manager.' using errcode = 'P0001';
    end if;
    if not new.is_demo then new.reading_for := now(); end if;
  elsif new.result <> old.result or new.note is distinct from old.note or new.recorded_at <> old.recorded_at then
    raise exception 'Void the entry with a reason and enter it again.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.cleaning_checks_before_write() from public, anon, authenticated;
create trigger cleaning_checks_stamp before insert on public.cleaning_checks for each row execute function public.stamp_recorded();
create trigger cleaning_checks_before_write before insert or update on public.cleaning_checks
  for each row execute function public.cleaning_checks_before_write();
select public.enable_audit('public.cleaning_checks', true);
select public.enable_audit('public.cleaning_signoffs', true);

create or replace function public.void_cleaning_check(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c public.cleaning_checks;
begin
  select * into c from public.cleaning_checks where id = p_id and voided_at is null;
  if c.id is null then raise exception 'Entry not found.' using errcode = 'P0001'; end if;
  if not (c.recorded_by_id = auth.uid() or public.is_engineer_or_above()) then
    raise exception 'Only the person who entered it or an engineer can void it.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cleaning_signoffs where week_start = c.week_start) then
    raise exception 'This week has been signed off by the manager.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.cleaning_checks set voided_at = now(), void_reason = p_reason where id = p_id;
end;
$$;
revoke execute on function public.void_cleaning_check(uuid, text) from public, anon;

-- ---------------------------------------------------------------- RLS
alter table public.amc_contracts enable row level security;
alter table public.amc_schedule enable row level security;
alter table public.amc_visits enable row level security;
alter table public.cleaning_zones enable row level security;
alter table public.cleaning_activities enable row level security;
alter table public.cleaning_checks enable row level security;
alter table public.cleaning_signoffs enable row level security;
revoke all on public.amc_contracts, public.amc_schedule, public.amc_visits, public.cleaning_zones,
  public.cleaning_activities, public.cleaning_checks, public.cleaning_signoffs from anon;

create policy amc_contracts_read on public.amc_contracts for select to authenticated using (true);
create policy amc_contracts_write on public.amc_contracts for insert to authenticated
  with check (public.has_role('admin', 'section_manager'));
create policy amc_contracts_update on public.amc_contracts for update to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));
create policy amc_schedule_read on public.amc_schedule for select to authenticated using (true);
-- schedule writes go through set_amc_plan
create policy amc_visits_read on public.amc_visits for select to authenticated using (true);
create policy amc_visits_insert on public.amc_visits for insert to authenticated
  with check (public.is_engineer_or_above() and recorded_by_type = 'person' and not is_demo);

create policy cleaning_zones_read on public.cleaning_zones for select to authenticated using (true);
create policy cleaning_activities_read on public.cleaning_activities for select to authenticated using (true);
create policy cleaning_checks_read on public.cleaning_checks for select to authenticated using (true);
create policy cleaning_checks_insert on public.cleaning_checks for insert to authenticated
  with check (public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
              and recorded_by_type = 'person' and not is_demo);
create policy cleaning_signoffs_read on public.cleaning_signoffs for select to authenticated using (true);
create policy cleaning_signoffs_insert on public.cleaning_signoffs for insert to authenticated
  with check (public.has_role('shift_manager', 'section_manager', 'admin') and signed_by = auth.uid() and not is_demo);
