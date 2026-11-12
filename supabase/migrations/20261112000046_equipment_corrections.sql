-- Equipment list corrections from the section manager (2026-11-12). Nothing is deleted: duplicates are merged into
-- the right code (aliases, register lists, meters moved) and retired; removed equipment is retired (history kept).
-- Register equipment lists get an "active" switch so a machine can leave a register without deleting the link.
-- Safe to run more than once (also run after the seed on fresh databases: supabase/seed/70_equipment_corrections.sql).

alter table public.register_assets add column if not exists active boolean not null default true;

do $$
declare
  id_of jsonb := (select jsonb_object_agg(code, id) from public.assets);
  m record;
begin
  perform public.set_change_reason('Equipment list corrections by the section manager (2026-11-12)');

  -- 1. Duplicates merged into the right code, then retired
  for m in select * from (values ('BLR-06', 'BLR-03'), ('BLR-07', 'BLR-04'), ('CMP-13', 'CMP-11'), ('CMP-AC1', 'CMP-10'), ('CHV-U2', 'CHV-04')) v(dup, keep) loop
    continue when id_of->>m.dup is null or id_of->>m.keep is null;
    update public.asset_aliases set asset_id = (id_of->>m.keep)::uuid where asset_id = (id_of->>m.dup)::uuid;
    update public.meters set asset_id = (id_of->>m.keep)::uuid where asset_id = (id_of->>m.dup)::uuid;
    update public.downtime_events set asset_id = (id_of->>m.keep)::uuid where asset_id = (id_of->>m.dup)::uuid;
    insert into public.register_assets (register_id, asset_id, sort)
    select register_id, (id_of->>m.keep)::uuid, sort from public.register_assets where asset_id = (id_of->>m.dup)::uuid
    on conflict (register_id, asset_id) do update set active = true;
    update public.register_assets set active = false where asset_id = (id_of->>m.dup)::uuid;
    insert into public.asset_aliases (asset_id, alias, source, confirmed, note)
    select (id_of->>m.keep)::uuid, a.name, 'merged', true, 'Former code ' || a.code
      from public.assets a where a.code = m.dup
    on conflict (source, alias) do nothing;
    update public.assets set status = 'retired', confirmed = true,
           notes = format('Same machine as %s: merged into %s (2026-11-12).', m.keep, m.keep)
     where code = m.dup;
  end loop;

  -- 2. Removed equipment (retired, history kept)
  update public.assets set status = 'retired', confirmed = true, notes = 'Removed from the equipment list (2026-11-12).'
   where code in ('DRY-11', 'DRY-12', 'N2G-U2-01', 'N2G-U2-02');
  update public.assets set status = 'retired', confirmed = true, notes = 'Decommissioned (2026-11-12).' where code = 'BH-03';
  update public.register_assets ra set active = false from public.assets a where a.id = ra.asset_id and a.status = 'retired';

  -- 3. Corrections to existing equipment
  update public.assets set area = 'U2', capacity = '2 t/h', rated_output = 2, rated_unit = 't/h', confirmed = true where code = 'BLR-03';
  update public.assets set area = 'U2', capacity = '3.5 t/h (waste heat)', rated_output = 3.5, rated_unit = 't/h', confirmed = true where code = 'BLR-04';
  update public.assets set area = 'U2', model = 'MH75', confirmed = true where code = 'CMP-11';
  update public.assets set area = 'U2', confirmed = true where code = 'CMP-12';
  update public.assets set name = 'Air Compressor 10 - Oil-free (Atlas Copco)', make = 'Atlas Copco', confirmed = true where code = 'CMP-10';
  update public.assets set area = 'U2', make = 'Ingersoll Rand', confirmed = true where code in ('DRY-09', 'DRY-10');
  update public.assets set make = 'Atlas Copco', confirmed = true where code in ('DRY-04', 'DRY-05', 'DRY-08');
  update public.assets set area = 'U1', confirmed = true where code = 'CHK-01';
  update public.assets set area = 'U2', confirmed = true where code = 'CHV-04';

  -- dryers follow their make and area on the register lists
  update public.register_assets set active = false
   where register_id in (select id from public.registers where area = 'U1' and title in ('Air Dryer (Atlas Copco) Log Report', 'Air Dryer (IR) Log Report'))
     and asset_id in (select id from public.assets where code in ('DRY-05', 'DRY-08', 'DRY-09', 'DRY-10'));
  insert into public.register_assets (register_id, asset_id, sort)
  select r.id, a.id, row_number() over (order by a.code)
    from public.registers r, public.assets a
   where r.area = 'U1' and r.title = 'Air Dryer (Atlas Copco) Log Report' and a.code in ('DRY-05', 'DRY-08')
  on conflict (register_id, asset_id) do update set active = true;
  insert into public.register_assets (register_id, asset_id, sort)
  select r.id, a.id, row_number() over (partition by r.id order by a.code)
    from public.registers r, public.assets a
   where r.area = 'U2' and r.title in ('Air Dryer Logbook', 'IR TMS Air Dryer Log Report') and a.code in ('DRY-09', 'DRY-10')
  on conflict (register_id, asset_id) do update set active = true;
  -- VAM Chiller 4 is in Utility 2: off the Utility 1 logbook
  update public.register_assets set active = false
   where asset_id = (id_of->>'CHV-04')::uuid and register_id in (select id from public.registers where area = 'U1');

  -- 4. New Utility 2 equipment (PM copied from the Utility 1 unit)
  insert into public.assets (code, name, category_id, area, confirmed, notes)
  select v.code, v.name, c.id, 'U2', true, 'Added by the section manager (2026-11-12).'
    from (values ('TNK-AR-U2', 'Air Receiver Tanks (Utility 2)', 'Storage Tanks'),
                 ('SOF-02', 'Softener Plant (Utility 2)', 'Water Treatment'),
                 ('DST-AIR-U2', 'Compressed Air Distribution (Utility 2)', 'Distribution Systems'),
                 ('DST-CHW-U2', 'Chilled Water Distribution (Utility 2)', 'Distribution Systems'),
                 ('DST-CND-U2', 'Steam Condensate Collection (Utility 2)', 'Distribution Systems'),
                 ('DST-STM-U2', 'Steam Distribution (Utility 2)', 'Distribution Systems'),
                 ('DST-TW-U2', 'Treated Water Distribution (Utility 2)', 'Distribution Systems')) v(code, name, cat)
    join public.asset_categories c on c.name = v.cat
  on conflict (code) do nothing;
  insert into public.pm_tasks (frequency, register_sn, equipment_as_written, asset_id, area, tasks, hours_interval, document_no, active)
  select p.frequency, p.register_sn, p.equipment_as_written || ' (UTILITY 2)', n.id, 'U2', p.tasks, p.hours_interval, p.document_no, p.active
    from public.pm_tasks p
    join public.assets o on o.id = p.asset_id
    join public.assets n on n.code = case o.code when 'TNK-AR' then 'TNK-AR-U2' when 'SOF-01' then 'SOF-02' else o.code || '-U2' end
   where o.code in ('TNK-AR', 'SOF-01', 'DST-AIR', 'DST-CHW', 'DST-CND', 'DST-STM', 'DST-TW')
  on conflict (frequency, register_sn, equipment_as_written) do nothing;

  -- 5. Word casing
  update public.assets set name = 'Utility 1 General Plant' where code = 'SYS-U1';
  update public.assets set name = 'Utility 2 General Plant' where code = 'SYS-U2';
  update public.assets set name = 'Boiler 1 (Loos)', make = 'Loos' where code = 'BLR-01';
  update public.assets set name = 'Boiler 2 (Shellmax)', make = 'Shellmax' where code = 'BLR-02';
  update public.assets set name = replace(name, '(THERMAX)', '(Thermax)'), make = 'Thermax' where code in ('BLR-03', 'BLR-04', 'BLR-05');
  update public.assets set name = replace(name, 'TRANE ', 'Trane ') where code like 'CHT-%';
  update public.assets set name = replace(name, '(air-cooled)', '(Air-Cooled)') where code in ('CHC-01', 'CHK-01');
  update public.registers set title = replace(title, 'THERMAX', 'Thermax') where title like '%THERMAX%';
  -- each word gets a capital first letter (also after "3-"); words already capitalised and "&/and/of/to" are kept
  update public.register_sections s
     set title = (select string_agg(case when w in ('&', 'and', 'of', 'to') or wm is null then w
                                         else coalesce(wm[1], '') || upper(wm[2]) || wm[3] end, ' ' order by i)
                    from regexp_split_to_table(s.title, ' ') with ordinality t(w, i)
                    cross join lateral (select regexp_match(w, '^([0-9]+-)?([a-z])(.*)$') as wm) x)
   where s.title ~ '(^| |-)[a-z]';
  update public.meters set name = 'Air Compressor 10 (Atlas Copco) – energy' where code = 'CATLAS-KWH';
end $$;
