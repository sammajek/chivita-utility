-- Utility Consumption restructured (owner, 2026-11-12). Nothing is deleted: meters no longer used are switched off
-- (their readings stay). New tabs: Compressed Air, Steam, Gas and Diesel flowmeters. The "7 A.M." tab becomes
-- "Running Hours" and keeps only hours that no register records.
alter table public.meters drop constraint if exists meters_grp_check;
alter table public.meters add constraint meters_grp_check
  check (grp in ('daily', 'water', 'energy', 'borehole', 'condensate', 'air', 'steam', 'gas', 'diesel'));

do $$
declare id_of jsonb := (select jsonb_object_agg(code, id) from public.assets);
begin
  perform public.set_change_reason('Utility Consumption restructure (owner, 2026-11-12)');
  -- the 7 A.M. sheet's "Boiler 4" is Boiler 5
  update public.meters set code = replace(code, 'B4-', 'B5-'), asset_id = (id_of->>'BLR-05')::uuid
   where code in ('B4-GAS', 'B4-STM', 'B4-STR', 'B4-DH', 'B4-GH');
  -- steam and gas flow move to their own tabs
  update public.meters set grp = 'steam' where code in ('B1-STM', 'B2-STM', 'B5-STM', 'B5-STR');
  update public.meters set grp = 'gas' where code in ('B1-GAS', 'B2-GAS', 'B5-GAS', 'V2-GAS', 'V3-GAS');
  -- switched off: VAM 1 uses no gas; compressor kWh duplicates the Energy Meters; hours already in the registers
  update public.meters set active = false
   where code in ('V1-GAS', 'V1-GH', 'C2-KWH', 'C3-KWH', 'C4-KWH', 'C5-KWH', 'C6-KWH', 'C7-KWH', 'C8-KWH', 'C9-KWH', 'CATLAS-KWH',
                  'T1-H', 'T2-H', 'T3-H', 'T4-H', 'T5-H', 'V1-TH', 'V2-TH', 'V3-TH',
                  'B1-DH', 'B1-GH', 'B2-DH', 'B2-GH', 'B5-DH', 'B5-GH');

  -- new meters
  insert into public.meters (code, name, grp, asset_id, unit, kind, sort)
  select v.code, v.name, v.grp, (id_of->>v.asset)::uuid, v.unit, 'totaliser', v.sort
    from (values
      ('A-C2', 'Air Compressor 2 – Air Flow', 'air', 'CMP-02', 'm³', 201), ('A-C3', 'Air Compressor 3 – Air Flow', 'air', 'CMP-03', 'm³', 202),
      ('A-C4', 'Air Compressor 4 – Air Flow', 'air', 'CMP-04', 'm³', 203), ('A-C5', 'Air Compressor 5 – Air Flow', 'air', 'CMP-05', 'm³', 204),
      ('A-C6', 'Air Compressor 6 – Air Flow', 'air', 'CMP-06', 'm³', 205), ('A-C7', 'Air Compressor 7 – Air Flow', 'air', 'CMP-07', 'm³', 206),
      ('A-C8', 'Air Compressor 8 – Air Flow', 'air', 'CMP-08', 'm³', 207), ('A-C9', 'Air Compressor 9 – Air Flow', 'air', 'CMP-09', 'm³', 208),
      ('A-C10', 'Air Compressor 10 – Air Flow', 'air', 'CMP-10', 'm³', 209), ('A-C11', 'Air Compressor 11 – Air Flow', 'air', 'CMP-11', 'm³', 210),
      ('A-C12', 'Air Compressor 12 – Air Flow', 'air', 'CMP-12', 'm³', 211),
      ('A-CEN1', 'Central Air Header 1 – Air Flow', 'air', null, 'm³', 221), ('A-CEN2', 'Central Air Header 2 – Air Flow', 'air', null, 'm³', 222),
      ('A-CEN3', 'Central Air Header 3 – Air Flow', 'air', null, 'm³', 223),
      ('B3-STM', 'Boiler 3 – Steam Flow', 'steam', 'BLR-03', 't', 303), ('B4-STM', 'Boiler 4 – Steam Flow', 'steam', 'BLR-04', 't', 304),
      ('V1-STM', 'VAM 1 – Steam Flow', 'steam', 'CHV-01', 't', 311),
      ('B3-GAS', 'Boiler 3 – Gas Flow', 'gas', 'BLR-03', 'm³', 403),
      ('B1-DSL', 'Boiler 1 – Diesel Flow', 'diesel', 'BLR-01', 'L', 501), ('B2-DSL', 'Boiler 2 – Diesel Flow', 'diesel', 'BLR-02', 'L', 502),
      ('B3-DSL', 'Boiler 3 – Diesel Flow', 'diesel', 'BLR-03', 'L', 503), ('B5-DSL', 'Boiler 5 – Diesel Flow', 'diesel', 'BLR-05', 'L', 505),
      ('V2-DSL', 'VAM 2 – Diesel Flow', 'diesel', 'CHV-02', 'L', 512), ('V3-DSL', 'VAM 3 – Diesel Flow', 'diesel', 'CHV-03', 'L', 513)
    ) v(code, name, grp, asset, unit, sort)
  on conflict (code) do nothing;

  -- names and order (consistent casing)
  update public.meters m set name = v.name, sort = v.sort
    from (values
      ('B1-STM', 'Boiler 1 – Steam Flow', 301), ('B2-STM', 'Boiler 2 – Steam Flow', 302), ('B5-STM', 'Boiler 5 – Steam Flow', 305),
      ('B5-STR', 'Boiler 5 – Steam Flow Rate', 306),
      ('B1-GAS', 'Boiler 1 – Gas Flow', 401), ('B2-GAS', 'Boiler 2 – Gas Flow', 402), ('B5-GAS', 'Boiler 5 – Gas Flow', 405),
      ('V2-GAS', 'VAM 2 – Gas Flow', 412), ('V3-GAS', 'VAM 3 – Gas Flow', 413),
      ('V2-GH', 'VAM 2 – Gas Running Hours', 601), ('V3-GH', 'VAM 3 – Gas Running Hours', 602),
      ('E-ICEP', 'Ice Water Pumps', null), ('E-TWP', 'Treated Water Pumps', null),
      ('W-WTP', 'WTP Output', null), ('W-BWASH', 'WTP Backwash', null), ('W-RECOV', 'Water Recovery', null),
      ('CD-OBCR92', 'Condensate – Old Building CIP Room', null)
    ) v(code, name, sort)
   where m.code = v.code and v.sort is not null;
  update public.meters m set name = v.name from (values ('E-ICEP', 'Ice Water Pumps'), ('E-TWP', 'Treated Water Pumps'), ('W-WTP', 'WTP Output'), ('W-BWASH', 'WTP Backwash'), ('W-RECOV', 'Water Recovery'), ('CD-OBCR92', 'Condensate – Old Building CIP Room')) v(code, name) where m.code = v.code;
end $$;
