-- Dashboard maintenance KPIs (owner, 2026-11-13): PM completion and follow-ups for a period and area(s),
-- with the same rules as the Engineer KPI tracker.
--   PM completion  = PM periods ending in the period (and already ended) carried out (√ or X) ÷ due
--   Follow-ups     = follow-ups due in the period closed by their due date ÷ follow-ups due (once due, or closed)
--   Open / overdue = follow-ups open now in the area(s)
create or replace function public.maintenance_kpis(p_from date, p_to date, p_areas public.area_code[] default '{U1,U2}')
returns table (pm_done numeric, pm_due numeric, fu_on_time numeric, fu_due numeric, fu_open int, fu_overdue int)
language sql
stable
security definer
set search_path = public
as $$
  with pf as (select public.pm_kpi_start() as d, public.lagos_now()::date as today),
  pm as (
    select count(*)::numeric as due, count(c.id)::numeric as done
      from pf
      join public.pm_tasks k on k.active and k.area = any (p_areas)
      cross join lateral (
        select distinct public.pm_period_start(k.frequency, d::date) as ps
          from generate_series(greatest(p_from - 366, pf.d), p_to - 1, interval '1 day') d
      ) per
      left join public.pm_completions c on c.task_id = k.id and c.period_start = per.ps and c.voided_at is null and c.result in ('done_ok', 'done_not_ok')
     where per.ps >= pf.d
       and public.pm_period_end(k.frequency, per.ps) > p_from
       and public.pm_period_end(k.frequency, per.ps) <= least(p_to, pf.today + 1)
  ),
  items as (select * from public.followup_items(p_areas)),
  fu as (
    select count(*) filter (where i.closed_at is not null and (i.closed_at at time zone 'Africa/Lagos')::date <= i.due)::numeric as on_time,
           count(*)::numeric as due
      from items i, pf
     where i.due >= p_from and i.due < p_to and (i.due < pf.today or i.closed_at is not null)
  ),
  open_now as (
    select count(*)::int as n, count(*) filter (where i.due < pf.today)::int as late from items i, pf where i.closed_at is null
  )
  select pm.done, pm.due, fu.on_time, fu.due, open_now.n, open_now.late
    from pm, fu, open_now
   where public.is_active_user() or auth.uid() is null
$$;
revoke execute on function public.maintenance_kpis(date, date, public.area_code[]) from public, anon;
