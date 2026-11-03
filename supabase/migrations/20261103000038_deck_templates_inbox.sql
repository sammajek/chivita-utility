-- Saved deck templates (sections, area, rolling period) with an optional weekly / monthly schedule.
-- At the scheduled hour each recipient gets an in-app message (and a queued e-mail) with a download link;
-- the deck itself is built from live data when they open the link, so no plant figures travel in messages.

create table public.deck_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) >= 3),
  template      text not null default 'custom',
  title         text,
  sections      text[] not null check (cardinality(sections) > 0),
  area          public.area_code,
  period        text not null default 'last_week'
                  check (period in ('last_7_days', 'last_week', 'last_month', 'month_to_date', 'last_30_days')),
  owner_id      uuid not null default auth.uid() references public.profiles (id),
  shared        boolean not null default true,
  schedule      text not null default 'none' check (schedule in ('none', 'weekly', 'monthly')),
  schedule_dow  int check (schedule_dow between 1 and 7),     -- ISO: 1 = Monday
  schedule_day  int check (schedule_day between 1 and 28),
  schedule_hour int not null default 7 check (schedule_hour between 0 and 23),
  recipients    uuid[] not null default '{}',
  last_run_at   timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (schedule <> 'weekly' or schedule_dow is not null),
  check (schedule <> 'monthly' or schedule_day is not null)
);
create trigger deck_templates_touch before update on public.deck_templates for each row execute function public.touch_updated_at();
select public.enable_audit('public.deck_templates', false);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('escalation', 'digest', 'alert', 'report'));
alter table public.notifications add column link text;

-- Called by the 5-minute job: sends due scheduled decks once per scheduled hour.
create or replace function public.run_deck_schedules()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t record; n int := 0;
  now_l timestamp := public.lagos_now();
begin
  for t in
    select * from public.deck_templates d
     where d.active and d.schedule <> 'none' and cardinality(d.recipients) > 0
       and extract(hour from now_l) = d.schedule_hour
       and ((d.schedule = 'weekly' and extract(isodow from now_l) = d.schedule_dow)
            or (d.schedule = 'monthly' and extract(day from now_l) = d.schedule_day))
       and (d.last_run_at is null or d.last_run_at < now() - interval '50 minutes')
  loop
    insert into public.notifications (dedupe_key, recipient_id, recipient_email, channel, kind, subject, body, link)
    select 'deck:' || t.id || ':' || to_char(now_l, 'YYYY-MM-DD"T"HH24') || ':' || c.channel || ':' || p.id,
           p.id, case when c.channel = 'email' then p.email end, c.channel, 'report',
           format('Report ready: %s', t.name),
           format('Your scheduled deck "%s" (%s) is ready. Open the link to download it; it is built from live data when you open it.',
                  t.name, replace(t.period, '_', ' ')),
           '/reports/deck?saved=' || t.id
      from public.profiles p
      cross join (values ('in_app'), ('email')) c(channel)
     where p.id = any (t.recipients) and p.active
    on conflict (dedupe_key) do nothing;
    update public.deck_templates set last_run_at = now() where id = t.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.run_deck_schedules() from public, anon, authenticated;

create or replace function public.acknowledge_notification(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set acknowledged_at = coalesce(acknowledged_at, now())
   where id = p_id and recipient_id = auth.uid()
$$;
revoke execute on function public.acknowledge_notification(uuid) from public, anon;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_ops_flags(); select public.run_training_flags(); select public.run_deck_schedules(); select public.run_flag_job()');
  end if;
end $$;

alter table public.deck_templates enable row level security;
revoke all on public.deck_templates from anon;
create policy deck_templates_read on public.deck_templates for select to authenticated
  using (public.is_active_user() and (shared or owner_id = auth.uid() or public.is_manager_or_admin()));
create policy deck_templates_insert on public.deck_templates for insert to authenticated
  with check (public.is_active_user() and owner_id = auth.uid()
              and (schedule = 'none' or public.is_engineer_or_above()));
create policy deck_templates_update on public.deck_templates for update to authenticated
  using (owner_id = auth.uid() or public.is_manager_or_admin())
  with check (owner_id = auth.uid() or public.is_manager_or_admin());
