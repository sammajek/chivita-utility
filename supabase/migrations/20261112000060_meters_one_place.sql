-- Meter readings in one place (owner, 2026-11-12): totaliser readings leave the registers (fields switched off, past
-- readings kept) and are entered on Utility Consumption. Nitrogen totalisers get their own tab. Safe to run again.
alter table public.meters drop constraint if exists meters_grp_check;
alter table public.meters add constraint meters_grp_check
  check (grp in ('daily', 'water', 'energy', 'borehole', 'condensate', 'air', 'steam', 'gas', 'diesel', 'nitrogen'));

do $$
begin
  perform public.set_change_reason('Meter readings moved to Utility Consumption (owner, 2026-11-12)');
  update public.register_fields f set active = false
    from public.register_sections s, public.registers r
   where s.id = f.section_id and r.id = s.register_id and f.active
     and ((r.title in ('Boiler Log Report', 'VAM Chiller Log Report') and f.label = 'Gas Flowmeter Reading')
       or (r.title = 'Nitrogen Generator Log Report' and f.label ilike 'Total flow%'));

  insert into public.meters (code, name, grp, asset_id, unit, kind, sort)
  select 'N-' || n, 'Nitrogen Generator ' || n || ' – Nitrogen Flow', 'nitrogen', a.id, 'm³', 'totaliser', 700 + n
    from generate_series(1, 4) n join public.assets a on a.code = 'N2G-0' || n
  on conflict (code) do nothing;
end $$;
