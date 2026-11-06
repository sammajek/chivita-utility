-- Inputs for Utility OEE (Availability × Performance × Quality), per asset, for a period [p_from, p_to):
--   in_spec / judged: readings in spec vs readings judged against a standard (Quality);
--   output: sum of daily use on the asset's output meter, i.e. a totaliser whose unit matches the top of the
--           asset's rated unit (e.g. meter "t" for rated "t/h"); gas and kWh meters are inputs, not output;
--           07:00 readings dated D cover D-1 07:00 → D 07:00, so dates after the start up to the end date count;
--   run_hours: increase of the running-hours counter in the period (largest counter if there are several).
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
    select u.asset_id, sum(u.used) as output, min(u.unit) as output_unit
      from meter_usage u
      join assets a on a.id = u.asset_id
     where u.kind = 'totaliser' and u.used is not null and u.unit is distinct from 'kWh' and u.code !~ 'GAS$'
       and a.rated_unit is not null and split_part(a.rated_unit, '/', 1) = u.unit
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
