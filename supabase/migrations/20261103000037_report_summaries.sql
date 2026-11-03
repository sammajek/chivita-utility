-- Summaries for the presentation generator (run as the signed-in user: row-level security applies).

-- Readings per register in a period: in spec / out of spec / critical / no standard, and missing-slot flags raised.
create or replace function public.report_reading_summary(p_from timestamptz, p_to timestamptz, p_area public.area_code default null)
returns table (register_id uuid, title text, document_no text, area public.area_code,
               ok bigint, out_of_spec bigint, critical bigint, info bigint, missing_flags bigint, late bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select g.id, g.title, g.document_no, g.area,
         count(r.id) filter (where r.status = 'ok'), count(r.id) filter (where r.status = 'out_of_spec'),
         count(r.id) filter (where r.status = 'critical'), count(r.id) filter (where r.status = 'info'),
         (select count(*) from public.flags f where f.register_id = g.id and f.kind = 'reading_missing'
                                                and f.raised_at >= p_from and f.raised_at < p_to),
         count(r.id) filter (where r.minutes_late > 60)
    from public.registers g
    left join public.readings r on r.register_id = g.id and r.voided_at is null and r.reading_for >= p_from and r.reading_for < p_to
   where (p_area is null or g.area = p_area) and g.monitor
   group by g.id, g.title, g.document_no, g.area
   order by g.area, g.title
$$;

-- PM per frequency: periods ending inside [p_from, p_to] (from the PM start date) due and carried out (√ or X).
create or replace function public.report_pm_summary(p_from date, p_to date, p_area public.area_code default null)
returns table (frequency text, tasks bigint, due bigint, done_ok bigint, done_not_ok bigint, not_done bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with pf as (select greatest(public.pm_kpi_start(), p_from - 366) as d),
  per as (
    select k.id, k.frequency, x.ps
      from public.pm_tasks k cross join pf
      cross join lateral (select distinct public.pm_period_start(k.frequency, d::date) as ps
                            from generate_series(greatest(p_from - 366, pf.d), p_to, interval '1 day') d) x
     where k.active and (p_area is null or k.area = p_area)
       and x.ps >= public.pm_kpi_start()
       and public.pm_period_end(k.frequency, x.ps) > p_from and public.pm_period_end(k.frequency, x.ps) <= p_to + 1
  )
  select per.frequency, count(distinct per.id), count(*),
         count(c.id) filter (where c.result = 'done_ok'), count(c.id) filter (where c.result = 'done_not_ok'),
         count(c.id) filter (where c.result = 'not_done')
    from per left join public.pm_completions c on c.task_id = per.id and c.period_start = per.ps and c.voided_at is null
   group by per.frequency
   order by array_position(array['daily', 'weekly', 'monthly', 'quarterly', 'bi_annual', 'annual'], per.frequency)
$$;
