-- Logger import: devices (energy meters, flowmeters, SCADA/THERMAX exports) send batches of readings with their own
-- API key, or an engineer uploads the logger's CSV export. Every value is kept in logger_data; a value within 15 min
-- of a register slot fills that slot (tagged to the logger, judged against the standard, flagged as usual); a meter
-- value between 06:45 and 07:15 becomes that day's 07:00 consumption reading.

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
  opens timestamptz;
begin
  if tg_op = 'UPDATE' then
    new.register_id := old.register_id; new.field_id := old.field_id; new.asset_id := old.asset_id;
    new.parameter_id := old.parameter_id; new.log_date := old.log_date; new.slot_key := old.slot_key;
    new.reading_for := old.reading_for; new.recorded_by_type := old.recorded_by_type;
    new.recorded_by_id := old.recorded_by_id; new.recorded_at := old.recorded_at;
    new.minutes_late := old.minutes_late; new.minutes_early := old.minutes_early; new.is_demo := old.is_demo;
    new.entry_method := old.entry_method; new.photo_path := old.photo_path;
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
    if not exists (select 1 from public.register_slots(new.log_date) rs
                    where rs.section_id = sec.id and rs.slot_key = new.slot_key) then
      raise exception 'Slot % is not a reading time on this register.', new.slot_key using errcode = 'P0001';
    end if;
    -- the slot decides the time a reading is for, not the phone
    new.reading_for := public.slot_due(sec.slot_kind, new.log_date, new.slot_key);
    if new.recorded_by_type = 'logger' and not new.is_demo then
      -- a data logger's value is placed in the slot its own timestamp falls in (checked by ingest_logger_rows):
      -- not late, not early
      new.minutes_early := 0;
      new.minutes_late := 0;
    elsif not new.is_demo then
      opens := public.slot_opens(sec.slot_kind, new.log_date, new.slot_key, public.setting_num('reading_early_window_min', 15));
      if now() < opens - interval '24 hours' then
        raise exception 'That slot is more than a day away. Check the date.' using errcode = 'P0001';
      end if;
      new.minutes_early := greatest(0, ceil(extract(epoch from (opens - now())) / 60))::int;
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

create table public.logger_data (
  id           bigint generated always as identity primary key,
  logger_id    uuid not null references public.loggers (id),
  ts           timestamptz not null,
  asset_id     uuid references public.assets (id),
  parameter_id uuid references public.parameters (id),
  meter_id     uuid references public.meters (id),
  value_num    numeric,
  value_text   text,
  placed       text not null check (placed in ('slot', 'meter', 'stored', 'rejected')),
  note         text,
  uploaded_by  uuid references auth.users (id),
  received_at  timestamptz not null default now()
);
create index logger_data_logger_ts_idx on public.logger_data (logger_id, ts desc);
create index logger_data_asset_ts_idx on public.logger_data (asset_id, parameter_id, ts desc);
alter table public.loggers add column last_seen_at timestamptz;
alter table public.loggers add column area public.area_code;

-- Places one batch of rows for a logger. Rows: [{asset_code, parameter, value, timestamp} | {meter_code, value, timestamp}].
create or replace function public.ingest_logger_rows(p_logger uuid, p_rows jsonb, p_uploaded_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x jsonb; i int := 0;
  ts timestamptz; v_num numeric; v_txt text;
  a public.assets; m public.meters; f record; sl record; p public.parameters;
  n_slot int := 0; n_meter int := 0; n_stored int := 0; rejects jsonb := '[]';
  placed text; note text;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a list' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'At most 5000 rows per batch.' using errcode = 'P0001'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; placed := 'stored'; note := null; a := null; m := null; p := null;
    begin
      ts := (x->>'timestamp')::timestamptz;
      if ts is null or ts > now() + interval '10 minutes' or ts < now() - interval '62 days' then
        raise exception 'timestamp missing, in the future, or older than 62 days';
      end if;
      v_txt := nullif(trim(x->>'value'), '');
      if v_txt is null then raise exception 'value missing'; end if;
      v_num := case when v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then v_txt::numeric end;

      if x ? 'meter_code' then
        select * into m from meters where code = x->>'meter_code' and active;
        if m.id is null then raise exception 'unknown meter %', x->>'meter_code'; end if;
        if v_num is null then raise exception 'meter value must be a number'; end if;
        if (ts at time zone 'Africa/Lagos')::time between time '06:45' and time '07:15'
           and not exists (select 1 from meter_readings r where r.meter_id = m.id and r.voided_at is null
                            and r.read_date = (ts at time zone 'Africa/Lagos')::date) then
          insert into meter_readings (meter_id, read_date, value, entry_method, recorded_by_type, recorded_by_id, comment)
          values (m.id, (ts at time zone 'Africa/Lagos')::date, v_num, 'logger', 'logger', p_logger, 'From logger');
          placed := 'meter'; n_meter := n_meter + 1;
        end if;
      else
        select * into a from assets where code = x->>'asset_code';
        if a.id is null then
          select s.* into a from asset_aliases al join assets s on s.id = al.asset_id where lower(al.alias) = lower(x->>'asset_code') limit 1;
        end if;
        if a.id is null then raise exception 'unknown equipment %', x->>'asset_code'; end if;
        -- the register field for this machine and parameter (pinned to it, or shared by its register)
        select rf.id as field_id, rf.section_id, rf.parameter_id into f
          from register_fields rf
          join parameters pp on pp.id = rf.parameter_id
          join register_sections rs on rs.id = rf.section_id
         where rf.active and lower(pp.name) = lower(x->>'parameter')
           and (rf.asset_id = a.id or (rf.asset_id is null and exists (select 1 from register_assets ra where ra.register_id = rs.register_id and ra.asset_id = a.id)))
         order by (rf.asset_id is not null) desc limit 1;
        if f.field_id is null then raise exception 'parameter "%" is not on a register for %', x->>'parameter', a.code; end if;
        select * into p from parameters where id = f.parameter_id;
        -- the slot whose time is within 15 minutes of the logger timestamp (today's or yesterday's log date)
        select s.log_date, s.slot_key into sl
          from (select d::date as log_date from generate_series(public.log_date_of(ts) - 1, public.log_date_of(ts), interval '1 day') d) dd
          cross join lateral public.register_slots(dd.log_date) s0
          cross join lateral (select dd.log_date, s0.slot_key, s0.due_at) s
         where s0.section_id = f.section_id and abs(extract(epoch from (s0.due_at - ts))) <= 15 * 60
         order by abs(extract(epoch from (s0.due_at - ts))) limit 1;
        if sl.slot_key is not null and not exists (
             select 1 from readings r where r.field_id = f.field_id and r.asset_id = a.id and r.log_date = sl.log_date
                                        and r.slot_key = sl.slot_key and r.voided_at is null) then
          insert into readings (field_id, asset_id, log_date, slot_key, reading_for, value_num, value_text, comment,
                                entry_method, recorded_by_type, recorded_by_id)
          values (f.field_id, a.id, sl.log_date, sl.slot_key, ts,
                  case when p.data_type = 'number' then v_num end, case when p.data_type <> 'number' then v_txt end,
                  case when public.evaluate_value(p, case when p.data_type = 'number' then v_num end,
                                                     case when p.data_type <> 'number' then v_txt end) in ('out_of_spec', 'critical')
                       then 'Logger value out of spec – engineer to record the action' end,
                  'logger', 'logger', p_logger);
          placed := 'slot'; n_slot := n_slot + 1;
        end if;
      end if;
      if placed = 'stored' then n_stored := n_stored + 1; end if;
    exception when others then
      placed := 'rejected'; note := sqlerrm;
      rejects := rejects || jsonb_build_object('row', i, 'reason', sqlerrm);
    end;
    insert into logger_data (logger_id, ts, asset_id, parameter_id, meter_id, value_num, value_text, placed, note, uploaded_by)
    values (p_logger, coalesce(ts, now()), a.id, p.id, m.id, v_num, v_txt, placed, note, p_uploaded_by);
  end loop;
  update loggers set last_seen_at = now() where id = p_logger;
  return jsonb_build_object('rows', i, 'register_slots', n_slot, 'meter_readings', n_meter, 'stored_only', n_stored,
                            'rejected', jsonb_array_length(rejects), 'errors', rejects);
end;
$$;
revoke execute on function public.ingest_logger_rows(uuid, jsonb, uuid) from public, anon, authenticated;

-- Device entry point (no login): the logger's own key.
create or replace function public.logger_ingest(p_key text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare lg public.loggers;
begin
  select * into lg from loggers
   where api_key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex') and active;
  if lg.id is null then raise exception 'Invalid or inactive logger key.' using errcode = '28000'; end if;
  return public.ingest_logger_rows(lg.id, p_rows, null);
end;
$$;
revoke execute on function public.logger_ingest(text, jsonb) from public;
grant execute on function public.logger_ingest(text, jsonb) to anon, authenticated;

-- CSV fallback: an engineer uploads a logger's export, tagged to that logger (uploader kept on each raw row).
create or replace function public.logger_csv_ingest(p_logger uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can upload logger data.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from loggers where id = p_logger and active) then
    raise exception 'Pick an active logger.' using errcode = 'P0001';
  end if;
  return public.ingest_logger_rows(p_logger, p_rows, auth.uid());
end;
$$;
revoke execute on function public.logger_csv_ingest(uuid, jsonb) from public, anon;

-- Admin: create a logger or issue a new key. The key is returned once and only its hash is stored.
create or replace function public.issue_logger_key(p_name text, p_description text, p_area public.area_code)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare k text := 'chi_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.has_role('admin') then raise exception 'Only an admin can issue logger keys.' using errcode = 'P0001'; end if;
  if coalesce(length(trim(p_name)), 0) < 3 then raise exception 'Give the logger a name.' using errcode = 'P0001'; end if;
  perform public.set_change_reason('Logger key issued');
  insert into loggers (name, description, area, api_key_hash, active)
  values (trim(p_name), nullif(trim(p_description), ''), p_area, encode(sha256(convert_to(k, 'UTF8')), 'hex'), true)
  on conflict (name) do update set api_key_hash = excluded.api_key_hash, active = true,
                                   description = coalesce(excluded.description, loggers.description), area = coalesce(excluded.area, loggers.area);
  return k;
end;
$$;
revoke execute on function public.issue_logger_key(text, text, public.area_code) from public, anon;

alter table public.logger_data enable row level security;
revoke all on public.logger_data from anon;
create policy logger_data_read on public.logger_data for select to authenticated using (public.is_active_user());
grant select (last_seen_at, area) on public.loggers to authenticated;
