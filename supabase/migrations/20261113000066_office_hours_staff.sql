-- Office-hours staff (owner, 2026-11-13): some users work Mon–Fri 08:00–17:00, not day/night shifts — e.g. the
-- Engineering Manager (viewer) and the maintenance team. For them:
--  * work_pattern = 'office': no shift check-in expected (they may still check in if covering a shift);
--  * alerts: 'maintenance' = PM, follow-up, AMC, calibration, open downtime and RCA flags in their areas, e-mailed in
--    batches during office hours (flags raised overnight arrive at the start of the working day);
--    'digest' = the daily 07:00 compliance digest (previously section managers only).
-- Office hours are settings: office_start_hour (8), office_end_hour (17); working days Monday–Friday.

alter table public.profiles add column work_pattern text not null default 'shift' check (work_pattern in ('shift', 'office'));
alter table public.profiles add column alerts text[] not null default '{}' check (alerts <@ array['maintenance', 'digest']);
alter table public.staff add column work_pattern text not null default 'shift' check (work_pattern in ('shift', 'office'));
alter table public.staff add column alerts text[] not null default '{}' check (alerts <@ array['maintenance', 'digest']);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('escalation', 'digest', 'alert', 'report', 'maintenance'));

insert into public.app_settings (key, value, description) values
  ('office_start_hour', '8', 'Office hours start (hour, Lagos time), Monday–Friday'),
  ('office_end_hour', '17', 'Office hours end (hour, Lagos time), Monday–Friday')
on conflict (key) do nothing;

-- A new account pre-approved on the Staff tab takes its work pattern and alerts from there; later Staff edits follow.
create or replace function public.profile_pattern_from_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'profiles' then
    declare s public.staff;
    begin
      select * into s from staff x where x.email = lower(new.email) and x.active limit 1;
      if s.id is not null then new.work_pattern := s.work_pattern; new.alerts := s.alerts; end if;
    end;
    return new;
  end if;
  if new.profile_id is not null and ((new.work_pattern, new.alerts) is distinct from (old.work_pattern, old.alerts)
                                     or new.profile_id is distinct from old.profile_id) then
    perform public.set_change_reason('Work pattern / alerts changed on the Staff tab');
    update profiles set work_pattern = new.work_pattern, alerts = new.alerts where id = new.profile_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.profile_pattern_from_staff() from public, anon, authenticated;
create trigger profiles_pattern_from_staff before insert on public.profiles for each row execute function public.profile_pattern_from_staff();
create trigger staff_pattern_to_profile after update on public.staff for each row execute function public.profile_pattern_from_staff();

create or replace function public.in_office_hours(p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = public
as $$
  select extract(isodow from l) between 1 and 5
     and extract(hour from l) >= public.setting_num('office_start_hour', 8)
     and extract(hour from l) < public.setting_num('office_end_hour', 17)
    from (select (p_at at time zone 'Africa/Lagos') as l) x
$$;

-- Maintenance alerts for office-hours staff: each open flag is sent to a person once, batched per run.
create or replace function public.run_office_alerts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare rec record; n int := 0;
begin
  if not public.in_office_hours() then return 0; end if;
  for rec in
    select p.id pid, p.email, p.whatsapp, array_agg(f.id order by f.raised_at) ids,
           array_to_string((array_agg('• ' || f.title order by f.raised_at))[1:30], E'\n')
             || case when count(*) > 30 then format(E'\n…and %s more', count(*) - 30) else '' end lines,
           count(*) cnt
      from profiles p
      join flags f on f.resolved_at is null and not f.is_demo
                  and f.kind in ('pm_overdue', 'pm_followup', 'followup_overdue', 'hours_service_due', 'amc_past_due', 'calibration_due',
                                 'downtime_open', 'rca_overdue', 'pm_photo_missing', 'pm_spot_check', 'pm_early_failure')
                  and (f.area is null or f.area = any (p.areas))
     where p.active and p.email is not null and p.work_pattern = 'office' and 'maintenance' = any (p.alerts)
       and not exists (select 1 from notifications nt where nt.recipient_id = p.id and nt.kind = 'maintenance' and f.id = any (nt.flag_ids))
     group by p.id, p.email, p.whatsapp
  loop
    insert into notifications (dedupe_key, recipient_id, recipient_email, recipient_phone, channel, kind, subject, body, flag_ids)
    values ('maint:' || rec.pid || ':' || to_char(now(), 'YYYYMMDDHH24MI'), rec.pid, rec.email, rec.whatsapp, 'email', 'maintenance',
            format('[CHI Utility] %s maintenance item(s)', rec.cnt), rec.lines || E'\n\nOpen the app: Flags page.', rec.ids)
    on conflict (dedupe_key) do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.run_office_alerts() from public, anon, authenticated;

-- The daily digest also goes to anyone who asked for it (e.g. the Engineering Manager).
do $$
declare d text := pg_get_functiondef('public.run_flag_job()'::regprocedure);
        old_where text := $q$where p.active and p.role = 'section_manager' and p.email is not null$q$;
begin
  if position(old_where in d) = 0 then raise exception 'run_flag_job digest recipients not found'; end if;
  execute replace(d, old_where, $q$where p.active and p.email is not null and (p.role = 'section_manager' or 'digest' = any (p.alerts))$q$);
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_pm_verification_flags(); select public.run_pm_spot_checks(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_ops_flags(); select public.run_training_flags(); select public.run_patrol_flags(); select public.run_handover_flags(); select public.run_deck_schedules(); select public.run_flag_job(); select public.run_office_alerts()');
  end if;
end $$;
