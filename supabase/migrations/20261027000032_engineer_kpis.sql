-- Individual Engineer KPI Tracker FY2026: 11 KPIs with targets.
-- Auto KPIs come from the app's records for the engineer's duty shifts (check-in) and areas;
-- the rest come from a weekly log the engineer fills in (as the "Weekly Log" sheet).

create table public.kpi_definitions (
  id          uuid not null unique default gen_random_uuid(),
  code        text primary key,
  name        text not null,
  category    text not null,
  target_text text not null,
  target_min  numeric not null,          -- pass when value ≥ target_min (all 11 KPIs are "higher is better")
  source      text not null check (source in ('auto', 'weekly')),
  formula     text not null,
  sort        int not null
);
select public.enable_audit('public.kpi_definitions', false);

insert into public.kpi_definitions (code, name, category, target_text, target_min, source, formula, sort) values
  ('unsafe_act', 'Unsafe Act Reporting %', 'Safety & HSE', '≥95%', 95, 'weekly', 'Unsafe acts reported ÷ unsafe acts observed (weekly log)', 1),
  ('gemba', 'GEMBA Obs. Closure %', 'Safety & HSE', '≥90%', 90, 'weekly', 'GEMBA observations closed ÷ raised (weekly log)', 2),
  ('permit', 'Work Permit Compliance %', 'Safety & HSE', '100%', 100, 'weekly', 'Work permits issued ÷ non-routine jobs (weekly log)', 3),
  ('pm', 'PM Task Completion %', 'Maintenance', '≥85%', 85, 'auto', 'PM periods ending in the month in my areas carried out (√ or X) ÷ due (PM log)', 4),
  ('amc', 'AMC Task Completion %', 'Maintenance', '≥85%', 85, 'auto', 'AMC visits done ÷ planned for the month, contracts in my areas (AMC tracker)', 5),
  ('availability', 'Equipment Availability % (My Shift)', 'Maintenance', '≥80%', 80, 'auto',
   '(equipment-hours on my shifts − unplanned breakdown hours) ÷ equipment-hours; equipment in my checked-in areas', 6),
  ('cw_temp', 'CW Temp Readings Compliance %', 'Utility Quality', '≥99%', 99, 'auto',
   'Chilled water outlet temperature readings in spec ÷ readings with a standard, on my shifts', 7),
  ('water_quality', 'Water Quality Compliance %', 'Utility Quality', '≥99%', 99, 'auto',
   'Water readings (TDS, conductivity, hardness, pH, turbidity, chlorine) in spec ÷ readings with a standard, on my shifts', 8),
  ('dew_point', 'Air Dew Pt Compliance %', 'Utility Quality', '≥99%', 99, 'auto', 'Air dryer dew point readings in spec ÷ readings with a standard, on my shifts', 9),
  ('leakage', 'Leakage Identification & Closure %', 'Utility Quality', '≥95%', 95, 'weekly', 'Leakages closed within 24 h ÷ identified (weekly log)', 10),
  ('thermax', 'THERMAX Monitoring Adherence %', 'Digital', '≥95%', 95, 'weekly', 'THERMAX callouts acted on ÷ callouts (weekly log)', 11);

create table public.engineer_weekly_logs (
  id                  uuid primary key default gen_random_uuid(),
  staff_ref           uuid not null references public.staff (id),
  week_start          date not null check (extract(isodow from week_start) = 1),  -- Monday, as the Weekly Log sheet
  gemba_raised        int check (gemba_raised >= 0),
  gemba_closed        int check (gemba_closed >= 0),
  unsafe_observed     int check (unsafe_observed >= 0),
  unsafe_reported     int check (unsafe_reported >= 0),
  near_miss           int check (near_miss >= 0),
  non_routine_jobs    int check (non_routine_jobs >= 0),
  permits_issued      int check (permits_issued >= 0),
  permits_carried     int check (permits_carried >= 0),
  leaks_identified    int check (leaks_identified >= 0),
  leaks_closed_24h    int check (leaks_closed_24h >= 0),
  leaks_escalated     int check (leaks_escalated >= 0),
  thermax_callouts    int check (thermax_callouts >= 0),
  thermax_acted       int check (thermax_acted >= 0),
  thermax_escalated   int check (thermax_escalated >= 0),
  notes               text,
  recorded_by_type    text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id      uuid,
  recorded_at         timestamptz not null default now(),
  reading_for         timestamptz,
  updated_at          timestamptz not null default now(),
  is_demo             boolean not null default false,
  unique (staff_ref, week_start),
  check (gemba_closed is null or gemba_raised is null or gemba_closed <= gemba_raised),
  check (unsafe_reported is null or unsafe_observed is null or unsafe_reported <= unsafe_observed),
  check (leaks_closed_24h is null or leaks_identified is null or leaks_closed_24h <= leaks_identified),
  check (thermax_acted is null or thermax_callouts is null or thermax_acted <= thermax_callouts)
);
create trigger engineer_weekly_stamp before insert on public.engineer_weekly_logs for each row execute function public.stamp_recorded();
create trigger engineer_weekly_touch before update on public.engineer_weekly_logs for each row execute function public.touch_updated_at();
create or replace function public.engineer_weekly_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.week_start > public.lagos_now()::date then
    raise exception 'You cannot fill in a future week.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and not new.is_demo then new.reading_for := public.lagos_ts(new.week_start, time '07:00'); end if;
  if tg_op = 'UPDATE' then
    new.recorded_by_type := old.recorded_by_type; new.recorded_by_id := old.recorded_by_id;
    new.recorded_at := old.recorded_at; new.reading_for := old.reading_for; new.is_demo := old.is_demo;
  end if;
  return new;
end;
$$;
create trigger engineer_weekly_before_write before insert or update on public.engineer_weekly_logs
  for each row execute function public.engineer_weekly_before_write();
select public.enable_audit('public.engineer_weekly_logs', false);

-- Who may write a weekly log: the engineer themself (their staff record is linked to their login), or managers.
create or replace function public.can_write_staff_log(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_manager_or_admin()
      or (public.is_engineer_or_above() and exists (select 1 from public.staff s where s.id = p_staff and s.profile_id = auth.uid()))
$$;
revoke execute on function public.can_write_staff_log(uuid) from public, anon;

-- Auto KPIs per month of a year for one login: numerator and denominator per KPI.
create or replace function public.engineer_kpi_auto(p_profile uuid, p_year int)
returns table (month date, kpi text, num numeric, den numeric)
language sql
stable
security definer
set search_path = public
as $$
  with months as (
    select make_date(p_year, m, 1) as m0, (make_date(p_year, m, 1) + interval '1 month')::date as m1 from generate_series(1, 12) m
  ),
  sess as (   -- my duty shifts with their 12-hour window
    select d.*, public.lagos_ts(d.shift_date, case d.shift when 'day' then time '07:00' else time '19:00' end) as w0,
           public.lagos_ts(d.shift_date, case d.shift when 'day' then time '07:00' else time '19:00' end) + interval '12 hours' as w1
      from public.duty_sessions d where d.profile_id = p_profile and extract(year from d.shift_date) = p_year
  ),
  my_areas as (select coalesce((select areas from public.profiles where id = p_profile), '{U1,U2}') as areas),
  quality as (
    select date_trunc('month', s.shift_date)::date as m0,
           case when p.name ilike 'chilled water outlet temp%' then 'cw_temp'
                when p.name ilike '%dew point%' then 'dew_point'
                when p.equipment_group ilike '%water%' and (p.name ~* '(tds|conductiv|hardness|ph\M|turbid|chlorin)') then 'water_quality'
                when p.name ~* '(feed ?water|cooling tower|treated water|raw water).*(tds|conductiv|hardness|ph\M|turbid|chlorin)' then 'water_quality'
           end as kpi,
           r.status
      from sess s
      join public.readings r on r.reading_for >= s.w0 and r.reading_for < s.w1 and r.voided_at is null
      join public.registers g on g.id = r.register_id and g.area = any (s.areas)
      join public.parameters p on p.id = r.parameter_id
     where r.status in ('ok', 'out_of_spec', 'critical')
  ),
  q as (
    select m0, kpi, count(*) filter (where status = 'ok')::numeric as num, count(*)::numeric as den
      from quality where kpi is not null group by m0, kpi
  ),
  avail as (
    select date_trunc('month', s.shift_date)::date as m0,
           sum(12.0 * (select count(*) from public.assets a where a.status <> 'retired' and a.area = any (s.areas))) as den,
           sum(coalesce((select sum(extract(epoch from (least(coalesce(e.end_at, now()), s.w1) - greatest(e.start_at, s.w0))) / 3600.0)
                           from public.downtime_events e join public.assets a on a.id = e.asset_id
                          where e.voided_at is null and e.downtime_type = 'Unplanned Breakdown' and a.area = any (s.areas)
                            and e.start_at < s.w1 and coalesce(e.end_at, now()) > s.w0), 0)) as down
      from sess s where s.w0 < now() group by 1
  ),
  pm as (
    select mo.m0, count(*)::numeric as den, count(c.id)::numeric as num
      from months mo
      cross join my_areas ma
      join public.pm_tasks k on k.active and k.area = any (ma.areas)
      cross join lateral (
        select distinct public.pm_period_start(k.frequency, d::date) as ps
          from generate_series(mo.m0 - 366, mo.m1 - 1, interval '1 day') d
      ) per
      left join public.pm_completions c on c.task_id = k.id and c.period_start = per.ps and c.voided_at is null and c.result <> 'not_done'
     where public.pm_period_end(k.frequency, per.ps) > mo.m0 and public.pm_period_end(k.frequency, per.ps) <= mo.m1
       and mo.m1 <= public.lagos_now()::date + 1
       and per.ps >= coalesce((select (value #>> '{}')::date from public.app_settings where key = 'pm_monitor_from'), '-infinity'::date)
     group by mo.m0
  ),
  amc as (
    select mo.m0, count(*)::numeric as den,
           count(*) filter (where exists (select 1 from public.amc_visits v where v.contract_id = s.contract_id and v.month = s.month and v.voided_at is null))::numeric as num
      from months mo
      cross join my_areas ma
      join public.amc_schedule s on s.month = mo.m0 and s.planned
      join public.amc_contracts c on c.id = s.contract_id and c.active and (c.area is null or c.area = any (ma.areas))
     where mo.m0 <= public.lagos_now()::date
     group by mo.m0
  )
  select * from (
    select m0, kpi, num, den from q
    union all select m0, 'availability', den - down, den from avail where den > 0
    union all select m0, 'pm', num, den from pm
    union all select m0, 'amc', num, den from amc
  ) x where public.is_active_user() or auth.uid() is null   -- only approved accounts (or the server itself)
$$;
revoke execute on function public.engineer_kpi_auto(uuid, int) from public, anon;

alter table public.kpi_definitions enable row level security;
alter table public.engineer_weekly_logs enable row level security;
revoke all on public.kpi_definitions, public.engineer_weekly_logs from anon;
create policy kpi_definitions_read on public.kpi_definitions for select to authenticated using (public.is_active_user());
create policy kpi_definitions_write on public.kpi_definitions for update to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));
create policy engineer_weekly_read on public.engineer_weekly_logs for select to authenticated using (public.is_active_user());
create policy engineer_weekly_insert on public.engineer_weekly_logs for insert to authenticated
  with check (public.can_write_staff_log(staff_ref) and recorded_by_type = 'person' and not is_demo);
create policy engineer_weekly_update on public.engineer_weekly_logs for update to authenticated
  using (public.can_write_staff_log(staff_ref)) with check (public.can_write_staff_log(staff_ref));
