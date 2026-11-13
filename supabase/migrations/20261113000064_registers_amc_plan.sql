-- Owner, 2026-11-13:
--  * Trane Chiller 3 is logged on the same register as the other Trane chillers (CHIENGUTRG07).
--  * Degasser 3 goes with the other degassers on the Utility 1 General Log Report (blower operation, per shift).
--  * AMC: managers/admin tick the planned months of a year for a contract in one save.
-- Safe to run more than once.

do $$
declare sec uuid; par uuid; dgs uuid;
begin
  perform public.set_change_reason('Register update by the section manager (2026-11-13)');

  -- Trane Chiller 3 on the Trane Chiller Log Report
  insert into public.register_assets (register_id, asset_id, sort)
  select r.id, a.id, 0 from public.registers r, public.assets a
   where r.area = 'U1' and r.title = 'Trane Chiller Log Report' and a.code = 'CHT-03'
  on conflict (register_id, asset_id) do update set active = true;
  update public.register_assets ra set sort = x.n
    from (select ra2.register_id, ra2.asset_id, row_number() over (partition by ra2.register_id order by a.code) n
            from public.register_assets ra2 join public.assets a on a.id = ra2.asset_id
            join public.registers r on r.id = ra2.register_id
           where r.area = 'U1' and r.title = 'Trane Chiller Log Report') x
   where ra.register_id = x.register_id and ra.asset_id = x.asset_id and ra.sort is distinct from x.n;

  -- Degasser 3 next to the other degassers
  select s.id into sec from public.register_sections s join public.registers r on r.id = s.register_id
   where r.area = 'U1' and r.title = 'General Log Report' and s.title = 'Chemicals, WTP & Auxiliaries';
  select id into dgs from public.assets where code = 'DGS-03';
  if sec is not null and dgs is not null and not exists (select 1 from public.register_fields where section_id = sec and asset_id = dgs) then
    select f.parameter_id into par from public.register_fields f join public.assets a on a.id = f.asset_id
     where f.section_id = sec and a.code = 'DGS-01';
    -- make room after "Utility 1 Degasser Blower Operation" (two steps: sort is unique per section)
    update public.register_fields set sort = -sort - 1
     where section_id = sec and sort > (select f.sort from public.register_fields f where f.section_id = sec and f.asset_id = (select id from public.assets where code = 'DGS-01'));
    update public.register_fields set sort = -sort where section_id = sec and sort < 0;
    insert into public.register_fields (section_id, parameter_id, asset_id, label, sort)
    select sec, par, dgs, 'Degasser 3 Blower Operation',
           (select f.sort + 1 from public.register_fields f where f.section_id = sec and f.asset_id = (select id from public.assets where code = 'DGS-01'));
  end if;
end $$;

-- Plan a whole year for a contract: p_months = the month numbers (1-12) that have a planned visit.
-- Months that already have a recorded visit are left as they are.
create or replace function public.set_amc_plan_year(p_contract uuid, p_year int, p_months int[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare m int; d date; want boolean; n int := 0;
begin
  if not public.is_manager_or_admin() then
    raise exception 'Only the section manager or admin can change the planned months.' using errcode = 'P0001';
  end if;
  if p_year not between 2023 and 2100 then raise exception 'Pick a valid year.' using errcode = 'P0001'; end if;
  perform public.set_change_reason(format('AMC planned months for %s set', p_year));
  for m in 1..12 loop
    d := make_date(p_year, m, 1);
    want := m = any (coalesce(p_months, '{}'));
    continue when exists (select 1 from amc_visits where contract_id = p_contract and month = d and voided_at is null);
    if want then
      insert into amc_schedule (contract_id, month, planned, updated_by) values (p_contract, d, true, auth.uid())
      on conflict (contract_id, month) do update set planned = true, updated_by = auth.uid(), updated_at = now()
        where amc_schedule.planned is distinct from true;
    else
      update amc_schedule set planned = false, updated_by = auth.uid(), updated_at = now()
       where contract_id = p_contract and month = d and planned;
    end if;
    get diagnostics n = row_count;
  end loop;
  return cardinality(coalesce(p_months, '{}'));
end;
$$;
revoke execute on function public.set_amc_plan_year(uuid, int, int[]) from public, anon;
