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
-- Registers brought in line with the equipment corrections (owner, 2026-11-12). Safe to run more than once.
--  * CMP-10 (Air Compressor 10 - Oil-free, Atlas Copco, U1) added to the Utility 1 oil-free compressor log.
--  * CMP-12 (Air Compressor 12 - Oil, Ingersoll Rand, now U2) added to the Utility 2 IR compressor log with CMP-11.
--  * Utility 1 "Chiller Logbook Thermax (THDC2)" switched off: its only machine, VAM Chiller 4, is in Utility 2
--    (the Utility 2 copy of the logbook carries it).
--  * Utility 2 "Nitrogen Generator Log Report" switched off until the owner confirms which nitrogen generators are in
--    Utility 2 (the two "Utility 2" generators were removed from the equipment list). Nothing is deleted.
do $$
begin
  insert into public.register_assets (register_id, asset_id, sort)
  select r.id, a.id, 10 from public.registers r, public.assets a
   where r.area = 'U1' and r.title = 'Air Compressor Log Report (Oil-free)' and a.code = 'CMP-10'
  on conflict (register_id, asset_id) do update set active = true;
  insert into public.register_assets (register_id, asset_id, sort)
  select r.id, a.id, 1 from public.registers r, public.assets a
   where r.area = 'U2' and r.title = 'IR MH75 Air Compressor Log Report' and a.code = 'CMP-12'
  on conflict (register_id, asset_id) do update set active = true;
  update public.registers set active = false, monitor = false,
         description = coalesce(description || ' ', '') || '[Switched off 2026-11-12: VAM Chiller 4 is in Utility 2.]'
   where area = 'U1' and title = 'Chiller Logbook Thermax (THDC2)' and active;
  update public.registers set active = false, monitor = false,
         description = coalesce(description || ' ', '') || '[Switched off 2026-11-12: Utility 2 nitrogen generators to be confirmed.]'
   where area = 'U2' and title = 'Nitrogen Generator Log Report' and active;
end $$;
-- Water Quality sampling plan (owner, 2026-11-12). Safe to run more than once; nothing is deleted (past results kept).
--  * Treated water: only "Water from utility" stays; the other treated-water points are taken off the plan.
--  * Utilities: "ETP (pre softener and post softener)" taken off the plan.
--  * Source water: "Borehole", not "Bore Hole"; Borehole 3 is decommissioned so it is no longer listed.
--  * Typo: "VAM Chiller Lithiu Bromide" -> "VAM Chiller Lithium Bromide".
update public.water_tests set active = false
 where active and ((sample_type = 'Treated water' and sampling_point <> 'Water from utility')
                   or (sample_type = 'Utilities' and sampling_point ilike 'ETP%'));
update public.water_tests set sampling_point = 'Borehole 1, 2, 4, 5, 6, 7' where sampling_point = 'Bore Hole 1,2,3,4,5,6,7';
update public.water_tests set sampling_point = replace(sampling_point, 'Bore Hole', 'Borehole') where sampling_point like '%Bore Hole%';
update public.water_tests set parameter = replace(parameter, 'Bore Hole', 'Borehole') where parameter like '%Bore Hole%';
update public.water_tests set sampling_point = 'VAM Chiller Lithium Bromide' where sampling_point = 'VAM Chiller Lithiu Bromide';
-- AMC contract names and vendors were stored in capitals (from the Excel tracker): normal casing, acronyms kept.
update public.amc_contracts
   set description = regexp_replace(initcap(description), '\mVam\M', 'VAM', 'g'),
       vendor = initcap(vendor)
 where description = upper(description) or vendor = upper(vendor);
update public.amc_contracts set description = replace(replace(replace(description, ' And ', ' and '), ' Across ', ' across '), ' Of ', ' of ');
-- Water Quality categories and sampling points in title case (owner, 2026-11-12), e.g. "Source Water",
-- "RO Reject Water". Acronyms kept; small joining words lower case.
update public.water_tests
   set sample_type = initcap(sample_type),
       sampling_point = replace(replace(replace(replace(replace(replace(
                          regexp_replace(regexp_replace(regexp_replace(initcap(sampling_point), '\mRo\M', 'RO', 'g'), '\mVam\M', 'VAM', 'g'), '\mEtp\M', 'ETP', 'g'),
                          ' Into ', ' into '), ' And ', ' and '), ' From ', ' from '), ' Of ', ' of '), ' For ', ' for '), ' The ', ' the ')
 where sample_type <> initcap(sample_type) or sampling_point ~ '(^| )[a-z]' or sampling_point ~ '\m(Ro|Vam)\M';
-- Owner's names for the two main points (2026-11-12).
update public.water_tests set sampling_point = 'Water from Raw Water Storage Tank'
 where sample_type = 'Raw Water' and sampling_point in ('Inlet into Water Treatment and Water Storage Tank', 'Inlet into water treatment and water storage tank');
update public.water_tests set sampling_point = 'Water to Distribution Header'
 where sample_type = 'Treated Water' and sampling_point in ('Water from Utility', 'Water from utility');
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
