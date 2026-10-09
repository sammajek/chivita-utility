-- Parameter logging: one row per value entered on a digital register.
-- Status (in spec / out of spec / critical) is decided by the database, not
-- the phone, so it can't be faked or skipped.

create type public.reading_status as enum ('ok', 'out_of_spec', 'critical', 'info');

create table public.readings (
  id               uuid primary key default gen_random_uuid(),
  register_id      uuid not null references public.registers (id),
  field_id         uuid not null references public.register_fields (id),
  asset_id         uuid not null references public.assets (id),
  parameter_id     uuid not null references public.parameters (id),
  log_date         date not null,
  slot_key         text not null,
  reading_for      timestamptz not null,
  value_num        numeric,
  value_text       text,
  status           public.reading_status not null default 'info',
  comment          text,
  action_taken     text,
  minutes_late     integer,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  amended          boolean not null default false,
  voided_at        timestamptz,
  voided_by        uuid references auth.users (id),
  void_reason      text,
  is_demo          boolean not null default false,
  check (value_num is not null or value_text is not null)
);

comment on column public.readings.log_date is 'The register date. A day runs 07:00 → 07:00, so a 03:00 reading belongs to the previous log date.';
comment on column public.readings.slot_key is 'Which slot on the sheet: "09:00", "day"/"night", "high"/"low" or "day".';
comment on column public.readings.reading_for is 'When the reading was due (slot time, Lagos). Lateness = recorded_at − reading_for.';

create unique index readings_one_per_slot
  on public.readings (field_id, asset_id, log_date, slot_key)
  where voided_at is null;
create index readings_register_date_idx on public.readings (register_id, log_date);
create index readings_asset_param_idx on public.readings (asset_id, parameter_id, reading_for);
create index readings_status_idx on public.readings (status, reading_for) where voided_at is null;
create index readings_recorder_idx on public.readings (recorded_by_id, recorded_at);

-- Pure evaluation used by the trigger and by the app for live feedback.
create or replace function public.evaluate_value(p public.parameters, v_num numeric, v_text text)
returns public.reading_status
language plpgsql
immutable
set search_path = public
as $$
begin
  if p.is_counter then
    return 'info';
  end if;
  if p.data_type = 'number' then
    if v_num is null then return 'info'; end if;
    if (p.crit_min is not null and v_num < p.crit_min) or (p.crit_max is not null and v_num > p.crit_max) then
      return 'critical';
    end if;
    if p.std_min is null and p.std_max is null then return 'info'; end if;
    if (p.std_min is not null and v_num < p.std_min) or (p.std_max is not null and v_num > p.std_max) then
      return 'out_of_spec';
    end if;
    return 'ok';
  elsif p.data_type = 'select' then
    if p.ok_options is null or cardinality(p.ok_options) = 0 then return 'info'; end if;
    if v_text = any (p.ok_options) then return 'ok'; end if;
    return 'out_of_spec';
  end if;
  return 'info';
end;
$$;

create or replace function public.readings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p   public.parameters;
  f   public.register_fields;
  sec public.register_sections;
begin
  if tg_op = 'UPDATE' then
    -- identity, slot and stamp fields are fixed once submitted
    new.register_id := old.register_id; new.field_id := old.field_id; new.asset_id := old.asset_id;
    new.parameter_id := old.parameter_id; new.log_date := old.log_date; new.slot_key := old.slot_key;
    new.reading_for := old.reading_for; new.recorded_by_type := old.recorded_by_type;
    new.recorded_by_id := old.recorded_by_id; new.recorded_at := old.recorded_at;
    new.minutes_late := old.minutes_late; new.is_demo := old.is_demo;
    if new.value_num is distinct from old.value_num or new.value_text is distinct from old.value_text then
      new.amended := true;
    end if;
  else
    select * into f from public.register_fields where id = new.field_id;
    if f.id is null then raise exception 'Unknown register field.' using errcode = 'P0001'; end if;
    select * into sec from public.register_sections where id = f.section_id;
    new.register_id := sec.register_id;
    new.parameter_id := f.parameter_id;
    if f.asset_id is not null then
      new.asset_id := f.asset_id;
    elsif not exists (select 1 from public.register_assets where register_id = sec.register_id and asset_id = new.asset_id) then
      raise exception 'That equipment is not on this register.' using errcode = 'P0001';
    end if;
    if not new.is_demo then
      new.minutes_late := greatest(0, floor(extract(epoch from (now() - new.reading_for)) / 60))::int;
    end if;
  end if;

  select * into p from public.parameters where id = new.parameter_id;
  if p.data_type = 'number' then
    if new.value_num is null then
      raise exception '% needs a number.', p.name using errcode = 'P0001';
    end if;
    new.value_text := null;
  elsif p.data_type = 'select' then
    if new.value_text is null or not (new.value_text = any (p.options)) then
      raise exception '% must be one of: %', p.name, array_to_string(p.options, ', ') using errcode = 'P0001';
    end if;
    new.value_num := null;
  end if;

  new.status := public.evaluate_value(p, new.value_num, new.value_text);

  if new.status in ('out_of_spec', 'critical') and new.voided_at is null
     and coalesce(trim(new.comment), '') = '' and coalesce(trim(new.action_taken), '') = '' then
    raise exception '% is out of spec. Add a comment or the action taken.', p.name using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger readings_stamp before insert on public.readings
  for each row execute function public.stamp_recorded();
create trigger readings_before_write before insert or update on public.readings
  for each row execute function public.readings_before_write();
select public.enable_audit('public.readings', true);

revoke execute on function public.readings_before_write() from public, anon, authenticated;

-- Amend a submitted value (keeps the old value in the audit log).
create or replace function public.amend_reading(
  p_id uuid, p_value_num numeric, p_value_text text, p_comment text, p_action text, p_reason text)
returns public.readings
language plpgsql
security definer
set search_path = public
as $$
declare r public.readings;
begin
  select * into r from public.readings where id = p_id and voided_at is null;
  if r.id is null then raise exception 'Reading not found.' using errcode = 'P0001'; end if;
  if not (r.recorded_by_id = auth.uid() or public.is_engineer_or_above()) then
    raise exception 'Only the person who entered it or an engineer can amend this reading.' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.readings
     set value_num = p_value_num, value_text = p_value_text,
         comment = coalesce(p_comment, comment), action_taken = coalesce(p_action, action_taken)
   where id = p_id
  returning * into r;
  return r;
end;
$$;

create or replace function public.void_reading(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.readings;
begin
  select * into r from public.readings where id = p_id and voided_at is null;
  if r.id is null then raise exception 'Reading not found.' using errcode = 'P0001'; end if;
  if not (r.recorded_by_id = auth.uid() or public.is_engineer_or_above()) then
    raise exception 'Only the person who entered it or an engineer can void this reading.' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  update public.readings set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = p_id;
end;
$$;

revoke execute on function public.amend_reading(uuid, numeric, text, text, text, text) from public, anon;
revoke execute on function public.void_reading(uuid, text) from public, anon;

alter table public.readings enable row level security;
revoke all on public.readings from anon;

create policy readings_read on public.readings
  for select to authenticated using (true);

create policy readings_insert on public.readings
  for insert to authenticated
  with check (
    public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin')
    and recorded_by_type = 'person'
  );
-- No update/delete policies: changes go through amend_reading / void_reading.
