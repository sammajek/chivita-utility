-- OEE inputs: output meter matched by rated unit, gas meters ignored, quality counts only judged readings.
begin;
update public.assets set rated_output = 3.5, rated_unit = 't/h' where code = 'BLR-04';
insert into public.meter_readings (meter_id, read_date, value, is_demo)
select id, d, v, true from public.meters, (values (date '2026-09-01', 1000), (date '2026-09-02', 1080), (date '2026-09-03', 1150)) x(d, v)
 where code = 'B4-STM';
insert into public.meter_readings (meter_id, read_date, value, is_demo)
select id, d, v, true from public.meters, (values (date '2026-09-01', 10), (date '2026-09-03', 900)) x(d, v)
 where code = 'B4-GAS';
do $$
declare r record;
begin
  select * into r from public.oee_inputs('2026-09-01 00:00+01', '2026-09-04 00:00+01') i
    join public.assets a on a.id = i.asset_id where a.code = 'BLR-04';
  assert r.output = 150 and r.output_unit = 't', format('steam output only, got %s %s', r.output, r.output_unit);
end $$;
rollback;
