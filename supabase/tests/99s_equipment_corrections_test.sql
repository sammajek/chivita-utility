-- Owner's equipment corrections: merges, retirements, areas, new U2 equipment with copied PM, casing.
do $$
begin
  assert (select status from public.assets where code = 'BLR-06') = 'retired', 'duplicate boiler retired';
  assert (select area from public.assets where code = 'BLR-03') = 'U2', 'boiler 3 in Utility 2';
  assert exists (select 1 from public.register_assets ra join public.assets a on a.id = ra.asset_id
                  join public.registers r on r.id = ra.register_id
                  where a.code = 'BLR-03' and r.title = '2 Tons/hr Boiler Log Report' and ra.active), 'boiler 3 on the U2 register';
  assert (select a.code from public.meters m join public.assets a on a.id = m.asset_id where m.code = 'CATLAS-KWH') = 'CMP-10', 'Atlas meter on CMP-10';
  assert (select name from public.assets where code = 'CMP-10') = 'Air Compressor 10 - Oil-free (Atlas Copco)', 'CMP-10 renamed';
  assert (select status from public.assets where code = 'BH-03') = 'retired', 'borehole 3 decommissioned';
  assert (select count(*) from public.pm_tasks p join public.assets a on a.id = p.asset_id where a.code = 'SOF-02') =
         (select count(*) from public.pm_tasks p join public.assets a on a.id = p.asset_id where a.code = 'SOF-01'), 'softener PM copied';
  assert (select name from public.assets where code = 'SYS-U1') = 'Utility 1 General Plant', 'casing';
  assert not exists (select 1 from public.register_sections where title ~ '(^| )[a-z]{4,}'), 'section titles in title case';
  assert exists (select 1 from public.register_sections where title = 'Boiler Water & Utility'), 'capitalised words kept';
  assert exists (select 1 from public.register_sections where title = '3-Hourly Readings'), 'number prefix handled';
  assert not exists (select 1 from public.register_assets ra join public.assets a on a.id = ra.asset_id where a.status = 'retired' and ra.active), 'retired off registers';
end $$;
