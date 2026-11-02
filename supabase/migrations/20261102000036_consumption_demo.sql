-- DEMO: daily 07:00 meter readings so the consumption screens can be reviewed before real data exists.
-- Rising totalisers / hour counters with plausible daily use per meter type; rates around a typical value.
-- Rows are marked is_demo (shown as DEMO) and can be removed with the demo clean-up.
create or replace function public.generate_consumption_demo(p_user uuid, p_days int default 45)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := public.lagos_now()::date;
  d date;
  n int := 0; k int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can generate demo data.' using errcode = 'P0001';
  end if;
  create temp table if not exists t_demo_meter on commit drop as
    select m.id, m.kind, m.unit, m.code,
           -- typical daily use (totalisers/hours) or value (rates)
           case when m.kind = 'hours' then 18
                when m.unit = 'kWh' then case when m.code like 'E-C%' then 1400 when m.code like 'E-T%' then 2600 else 450 end
                when m.code like 'B%-GAS' or m.code like 'V%-GAS' then 2200
                when m.code like 'B%-STM' then case when m.unit = 't' then 45 else 30 end
                when m.unit = 'm³' then case when m.code = 'W-WTP' then 1800 when m.code like 'W-L%' then 140 when m.code like 'BH%' then 320 else 90 end
                when m.code = 'B4-STR' then 2600
                else 3.5 end as typical,
           1000 + (abs(hashtext(m.code)) % 90000) as start_value
      from public.meters m where m.active;
  for k in reverse p_days..0 loop
    d := today - k;
    insert into public.meter_readings (meter_id, read_date, value, comment, recorded_by_type, recorded_by_id, recorded_at,
                                       reading_for, is_demo)
    select t.id, d,
           case when t.kind = 'rate' then round((t.typical * (0.85 + 0.3 * random()))::numeric, 1)
                else round((t.start_value + t.typical * (p_days - k) * (0.95 + 0.1 * random()))::numeric, 1) end,
           'DEMO', 'person', p_user, public.lagos_ts(d, time '07:10'), public.lagos_ts(d, time '07:00'), true
      from t_demo_meter t
     where not exists (select 1 from public.meter_readings r where r.meter_id = t.id and r.read_date = d and r.voided_at is null)
       and not (t.kind <> 'rate' and exists (select 1 from public.meter_readings r where r.meter_id = t.id and r.read_date > d
                                                                                    and r.voided_at is null and not r.is_demo));
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end;
$$;
revoke execute on function public.generate_consumption_demo(uuid, int) from public, anon, authenticated;
