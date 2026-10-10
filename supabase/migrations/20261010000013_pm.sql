-- Preventive maintenance (CHIENGUTRG08): task library, completions with the paper codes
-- Done OK (√) / Not Done (--) / Done Not OK (X), and the period each PM belongs to.

create table public.pm_tasks (
  id                   uuid primary key default gen_random_uuid(),
  frequency            text not null check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'bi_annual', 'annual')),
  register_sn          int not null,
  equipment_as_written text not null,
  asset_id             uuid references public.assets (id),
  area                 public.area_code not null default 'U1',
  tasks                text[] not null,
  hours_interval       int,   -- e.g. 8000 for "8000 hours maintenance" (running-hours trigger, shown as a note for now)
  document_no          text not null default 'CHIENGUTRG08',
  active               boolean not null default true,
  unique (frequency, register_sn, equipment_as_written)
);
create index pm_tasks_asset_idx on public.pm_tasks (asset_id);

-- First day of the PM period that contains p_date. Weeks start on Sunday (as the paper log).
create or replace function public.pm_period_start(p_freq text, p_date date)
returns date
language sql
immutable
as $$
  select case p_freq
    when 'daily' then p_date
    when 'weekly' then p_date - extract(dow from p_date)::int
    when 'monthly' then date_trunc('month', p_date)::date
    when 'quarterly' then date_trunc('quarter', p_date)::date
    when 'bi_annual' then make_date(extract(year from p_date)::int, case when extract(month from p_date) <= 6 then 1 else 7 end, 1)
    when 'annual' then date_trunc('year', p_date)::date
  end
$$;

-- First day after the period (exclusive end).
create or replace function public.pm_period_end(p_freq text, p_start date)
returns date
language sql
immutable
as $$
  select case p_freq
    when 'daily' then p_start + 1
    when 'weekly' then p_start + 7
    when 'monthly' then (p_start + interval '1 month')::date
    when 'quarterly' then (p_start + interval '3 months')::date
    when 'bi_annual' then (p_start + interval '6 months')::date
    when 'annual' then (p_start + interval '1 year')::date
  end
$$;

create table public.pm_completions (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.pm_tasks (id),
  period_start     date not null,
  result           text not null check (result in ('done_ok', 'not_done', 'done_not_ok')),
  note             text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  voided_by        uuid references auth.users (id),
  void_reason      text,
  is_demo          boolean not null default false,
  check (result = 'done_ok' or coalesce(trim(note), '') <> '')
);
create unique index pm_completions_one_per_period on public.pm_completions (task_id, period_start) where voided_at is null;
create index pm_completions_period_idx on public.pm_completions (period_start);

create or replace function public.pm_completions_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.pm_tasks;
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
    end if;
  else
    -- only voiding is allowed after submission (with a reason, via void_pm_completion)
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

create trigger pm_completions_stamp before insert on public.pm_completions
  for each row execute function public.stamp_recorded();
create trigger pm_completions_before_write before insert or update on public.pm_completions
  for each row execute function public.pm_completions_before_write();
select public.enable_audit('public.pm_completions', true);

create or replace function public.void_pm_completion(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c public.pm_completions;
begin
  select * into c from public.pm_completions where id = p_id and voided_at is null;
  if c.id is null then raise exception 'PM result not found.' using errcode = 'P0001'; end if;
  if not (c.recorded_by_id = auth.uid() or public.is_engineer_or_above()) then
    raise exception 'Only the person who entered it or an engineer can void this PM result.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.pm_completions set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = p_id;
end;
$$;
revoke execute on function public.void_pm_completion(uuid, text) from public, anon;

-- Load / refresh the task library from seed JSON:
-- {"texts": [...], "tasks": [{"f":"daily","sn":1,"eq":"STEAM BOILER 1","asset":"BLR-01","area":"U1","t":[0,1,2],"h":null}]}
create or replace function public.load_pm_tasks(p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can load the PM library.' using errcode = 'P0001';
  end if;
  insert into public.pm_tasks (frequency, register_sn, equipment_as_written, asset_id, area, tasks, hours_interval)
  select x->>'f', (x->>'sn')::int, x->>'eq',
         (select id from public.assets where code = x->>'asset'),
         coalesce(x->>'area', 'U1')::public.area_code,
         array(select p->'texts'->>(i::int) from jsonb_array_elements_text(x->'t') with ordinality as e(i, o) order by o),
         nullif(x->>'h', '')::int
    from jsonb_array_elements(p->'tasks') x
  on conflict (frequency, register_sn, equipment_as_written) do update
     set asset_id = excluded.asset_id, area = excluded.area, tasks = excluded.tasks, hours_interval = excluded.hours_interval;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.load_pm_tasks(jsonb) from public, anon, authenticated;

insert into public.app_settings (key, value, description) values
  ('pm_monitor_from', 'null'::jsonb,
   'Date (YYYY-MM-DD) from which missed PM periods raise flags. null = PM flags off until go-live.')
on conflict (key) do nothing;

alter table public.pm_tasks enable row level security;
alter table public.pm_completions enable row level security;
revoke all on public.pm_tasks, public.pm_completions from anon;

create policy pm_tasks_read on public.pm_tasks for select to authenticated using (true);
create policy pm_tasks_write on public.pm_tasks for all to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));

create policy pm_completions_read on public.pm_completions for select to authenticated using (true);
create policy pm_completions_insert on public.pm_completions for insert to authenticated
  with check (public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
              and recorded_by_type = 'person' and not is_demo);
-- voiding goes through void_pm_completion
