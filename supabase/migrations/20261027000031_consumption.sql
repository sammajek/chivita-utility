-- Utility consumption (7A.M Daily Utility Consumption Report): meters read once a day at 07:00.
-- Totalisers and hour counters: daily use = today's reading − the previous reading (a reset/replaced meter starts again).
-- Rates (e.g. condensate flow rate, boiler 4 steam kg/h) are recorded as read.

create table public.meters (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  grp       text not null check (grp in ('daily', 'water', 'energy', 'borehole', 'condensate')),
  asset_id  uuid references public.assets (id),
  unit      text,
  kind      text not null check (kind in ('totaliser', 'hours', 'rate')),
  sort      int not null default 0,
  max_daily numeric,
  active    boolean not null default true
);
comment on column public.meters.max_daily is 'Optional: daily use above this needs a comment (catches typing errors).';
select public.enable_audit('public.meters', false);

create table public.meter_readings (
  id               uuid primary key default gen_random_uuid(),
  meter_id         uuid not null references public.meters (id),
  read_date        date not null,
  value            numeric not null,
  is_reset         boolean not null default false,
  comment          text,
  entry_method     text not null default 'manual' check (entry_method in ('manual', 'photo', 'logger', 'paper', 'import')),
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  is_demo          boolean not null default false,
  check (not is_reset or coalesce(trim(comment), '') <> '')
);
create unique index meter_readings_one on public.meter_readings (meter_id, read_date) where voided_at is null;
create index meter_readings_date_idx on public.meter_readings (read_date);

create or replace function public.meter_readings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare m public.meters; prev numeric; nxt numeric;
begin
  if tg_op = 'UPDATE' then
    if new.value <> old.value or new.read_date <> old.read_date or new.meter_id <> old.meter_id or new.recorded_at <> old.recorded_at then
      raise exception 'Void the reading with a reason and enter it again.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  select * into m from meters where id = new.meter_id;
  if m.id is null or not m.active then raise exception 'Unknown meter.' using errcode = 'P0001'; end if;
  if new.read_date > public.lagos_now()::date then
    raise exception 'The reading date cannot be in the future.' using errcode = 'P0001';
  end if;
  if m.kind <> 'rate' and not new.is_reset then
    select value into prev from meter_readings where meter_id = m.id and read_date < new.read_date and voided_at is null
     order by read_date desc limit 1;
    if prev is not null and new.value < prev then
      raise exception '% is lower than the previous reading (%). If the meter was reset or replaced, tick "reset" and add a comment.',
        m.name, prev using errcode = 'P0001';
    end if;
    select value into nxt from meter_readings where meter_id = m.id and read_date > new.read_date and voided_at is null
     order by read_date limit 1;
    if nxt is not null and new.value > nxt then
      raise exception '% is higher than the next day''s reading (%).', m.name, nxt using errcode = 'P0001';
    end if;
    if m.max_daily is not null and prev is not null and new.value - prev > m.max_daily and coalesce(trim(new.comment), '') = '' then
      raise exception '% used % % since the last reading (more than the usual maximum %). Check the value or add a comment.',
        m.name, new.value - prev, coalesce(m.unit, ''), m.max_daily using errcode = 'P0001';
    end if;
  end if;
  if not new.is_demo then new.reading_for := public.lagos_ts(new.read_date, time '07:00'); end if;
  return new;
end;
$$;
revoke execute on function public.meter_readings_before_write() from public, anon, authenticated;
create trigger meter_readings_stamp before insert on public.meter_readings for each row execute function public.stamp_recorded();
create trigger meter_readings_before_write before insert or update on public.meter_readings
  for each row execute function public.meter_readings_before_write();
select public.enable_audit('public.meter_readings', true);

-- Daily use per meter: difference from the previous reading (spread over the days since, if a day was missed).
create or replace view public.meter_usage with (security_invoker = true) as
select r.id, r.meter_id, m.code, m.name, m.grp, m.unit, m.kind, m.asset_id, r.read_date, r.value, r.is_reset, r.comment, r.is_demo,
       p.read_date as prev_date, p.value as prev_value,
       case when m.kind = 'rate' then null
            when r.is_reset then r.value
            when p.value is null then null
            else r.value - p.value end as used,
       case when m.kind = 'rate' or p.read_date is null then 1 else r.read_date - p.read_date end as days
  from public.meter_readings r
  join public.meters m on m.id = r.meter_id
  left join lateral (select x.read_date, x.value from public.meter_readings x
                      where x.meter_id = r.meter_id and x.read_date < r.read_date and x.voided_at is null
                      order by x.read_date desc limit 1) p on true
 where r.voided_at is null;

create or replace function public.void_meter_reading(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.meter_readings;
begin
  select * into r from public.meter_readings where id = p_id and voided_at is null;
  if r.id is null then raise exception 'Reading not found.' using errcode = 'P0001'; end if;
  if not (r.recorded_by_id = auth.uid() or public.is_engineer_or_above()) then
    raise exception 'Only the person who entered it or an engineer can void it.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.meter_readings set voided_at = now(), void_reason = p_reason where id = p_id;
end;
$$;
revoke execute on function public.void_meter_reading(uuid, text) from public, anon;

-- {"meters": [{group, code, name, unit, kind, asset, sort}]}; re-running updates names/units/order.
create or replace function public.load_meters(p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can load meters.' using errcode = 'P0001';
  end if;
  insert into public.meters (code, name, grp, asset_id, unit, kind, sort)
  select x->>'code', x->>'name', x->>'group', (select id from public.assets where code = x->>'asset'),
         x->>'unit', x->>'kind', (x->>'sort')::int
    from jsonb_array_elements(p->'meters') x
  on conflict (code) do update set name = excluded.name, grp = excluded.grp, asset_id = excluded.asset_id,
                                   unit = excluded.unit, kind = excluded.kind, sort = excluded.sort;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.load_meters(jsonb) from public, anon, authenticated;

alter table public.meters enable row level security;
alter table public.meter_readings enable row level security;
revoke all on public.meters, public.meter_readings from anon;
create policy meters_read on public.meters for select to authenticated using (public.is_active_user());
create policy meters_write on public.meters for all to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));
create policy meter_readings_read on public.meter_readings for select to authenticated using (public.is_active_user());
create policy meter_readings_insert on public.meter_readings for insert to authenticated
  with check (public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
              and recorded_by_type = 'person' and not is_demo);
grant select on public.meter_usage to authenticated;
