-- Owner answers on the 7 A.M. consumption sheet (2026-11-06):
--   condensate flow is in kg/h; "ATLAS COMP." is an Atlas Copco air compressor (added, to be confirmed);
--   the compressor figures on that sheet are kWh readings, not hours.
insert into public.assets (code, name, category_id, make, confirmed, notes)
select 'CMP-AC1', 'Air Compressor - Atlas Copco', id, 'Atlas Copco', false,
       'Added from the 7 A.M. consumption sheet ("ATLAS COMP."); confirm number, area and model.'
  from public.asset_categories where name = 'Air Compressors'
on conflict (code) do nothing;

update public.meters set unit = 'kg/h' where grp = 'condensate' and unit is distinct from 'kg/h';

update public.meters m
   set code = replace(m.code, '-H', '-KWH'), name = replace(replace(m.name, '– hours', '– energy'), 'hours', 'energy'),
       unit = 'kWh', kind = 'totaliser',
       asset_id = coalesce(m.asset_id, (select id from public.assets where code = 'CMP-AC1'))
 where m.code in ('C2-H', 'C3-H', 'C4-H', 'C5-H', 'C6-H', 'C7-H', 'C8-H', 'C9-H', 'CATLAS-H');
