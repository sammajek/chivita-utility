-- Owner, 2026-11-12. Safe to run more than once (also run after the seed on fresh databases).
--  * VAM gas running hours are recorded in the Utility 1 VAM register (next to Running Hours), so the "Running Hours"
--    consumption tab is no longer needed (its two meters are switched off; readings kept).
--  * Steam flowmeters read in kg; reports show tonnes (kg ÷ 1000). OEE compares kg meters with t/h ratings.
--  * VAM 4 (Utility 2) will get an energy meter and a steam flowmeter: added switched off until installed.
insert into public.parameters (equipment_group, name, unit, data_type, is_counter)
select 'VAM Chiller', 'Gas Running Hours', 'h', 'number', true
 where not exists (select 1 from public.parameters where equipment_group = 'VAM Chiller' and name = 'Gas Running Hours');

do $$
declare sec uuid; par uuid := (select id from public.parameters where equipment_group = 'VAM Chiller' and name = 'Gas Running Hours');
begin
  select s.id into sec from public.register_sections s join public.registers r on r.id = s.register_id
   where r.area = 'U1' and r.title = 'VAM Chiller Log Report' and s.slot_kind = 'shift';
  if sec is not null and par is not null and not exists (select 1 from public.register_fields where section_id = sec and parameter_id = par) then
    perform public.set_change_reason('VAM gas running hours added to the register (owner, 2026-11-12)');
    update public.register_fields set sort = -(sort + 1) where section_id = sec and sort >= 1;   -- two steps: positions are unique
    update public.register_fields set sort = -sort where section_id = sec and sort < 0;
    insert into public.register_fields (section_id, label, parameter_id, sort) values (sec, 'Gas Running Hours (h)', par, 1);
  end if;
end $$;

update public.meters set active = false where code in ('V2-GH', 'V3-GH');
update public.meters set unit = 'kg' where grp = 'steam' and kind = 'totaliser' and unit is distinct from 'kg';

insert into public.meters (code, name, grp, asset_id, unit, kind, sort, active)
select v.code, v.name, v.grp, (select id from public.assets where code = 'CHV-04'), v.unit, 'totaliser', v.sort, false
  from (values ('E-V4', 'VAM Chiller 4', 'energy', 'kWh', 120), ('V4-STM', 'VAM 4 – Steam Flow', 'steam', 'kg', 312)) v(code, name, grp, unit, sort)
 where exists (select 1 from public.assets where code = 'CHV-04')
on conflict (code) do nothing;

-- Two central diesel flowmeters (owner, 2026-11-12).
insert into public.meters (code, name, grp, unit, kind, sort)
values ('D-CEN1', 'Central Diesel Flowmeter 1', 'diesel', 'L', 'totaliser', 521), ('D-CEN2', 'Central Diesel Flowmeter 2', 'diesel', 'L', 'totaliser', 522)
on conflict (code) do nothing;

-- OEE output: a kg meter counts against a t/h rating (÷ 1000).
create or replace function public.oee_inputs(p_from timestamptz, p_to timestamptz)
returns table (asset_id uuid, in_spec bigint, judged bigint, output numeric, output_unit text, run_hours numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select r.asset_id, count(*) filter (where r.status = 'ok') as in_spec,
           count(*) filter (where r.status in ('ok', 'out_of_spec', 'critical')) as judged
      from readings r
     where r.voided_at is null and r.reading_for >= p_from and r.reading_for < p_to
     group by r.asset_id
  ), o as (
    select u.asset_id,
           sum(u.used / case when u.unit = 'kg' and split_part(a.rated_unit, '/', 1) = 't' then 1000 else 1 end) as output,
           min(split_part(a.rated_unit, '/', 1)) as output_unit
      from meter_usage u
      join assets a on a.id = u.asset_id
     where u.kind = 'totaliser' and u.used is not null and u.unit is distinct from 'kWh' and u.code !~ '(GAS|DSL)$'
       and a.rated_unit is not null
       and (split_part(a.rated_unit, '/', 1) = u.unit or (u.unit = 'kg' and split_part(a.rated_unit, '/', 1) = 't'))
       and u.read_date > (p_from at time zone 'Africa/Lagos')::date and u.read_date <= (p_to at time zone 'Africa/Lagos')::date
     group by u.asset_id
  ), steps as (
    select r.asset_id, r.parameter_id,
           r.value_num - lag(r.value_num) over (partition by r.asset_id, r.parameter_id order by r.reading_for) as d
      from readings r
      join parameters p on p.id = r.parameter_id
     where p.is_counter and p.name in ('Running Hours', 'Operating Hours', 'Compressor Running Time')
       and r.voided_at is null and r.value_num is not null and r.reading_for >= p_from and r.reading_for < p_to
  ), h as (
    select asset_id, max(hrs) as run_hours
      from (select asset_id, parameter_id, sum(greatest(d, 0)) as hrs from steps where d is not null group by 1, 2) x
     group by asset_id
  )
  select coalesce(q.asset_id, o.asset_id, h.asset_id), coalesce(q.in_spec, 0), coalesce(q.judged, 0), o.output, o.output_unit, h.run_hours
    from q full join o on o.asset_id = q.asset_id
    full join h on h.asset_id = coalesce(q.asset_id, o.asset_id);
$$;
revoke execute on function public.oee_inputs(timestamptz, timestamptz) from public, anon;
grant execute on function public.oee_inputs(timestamptz, timestamptz) to authenticated;
