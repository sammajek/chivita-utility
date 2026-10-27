-- Consumption meters: daily use from totalisers, resets, rates, validation.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c9', 'consop@test.local');
update public.profiles set role = 'operator', active = true where email = 'consop@test.local';
do $$
begin
  assert (select count(*) from public.meters) = 93, '93 meters from the template';
  assert (select count(*) from public.meters where asset_id is null) = 22, 'most meters mapped to equipment';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c9', true);
do $$
declare g uuid := (select id from public.meters where code = 'B1-GAS');
        rt uuid := (select id from public.meters where code = 'B4-STR');
        d date := public.lagos_now()::date;
begin
  insert into public.meter_readings (meter_id, read_date, value) values (g, d - 3, 1000), (g, d - 2, 1450), (g, d, 2350);
  assert (select used from public.meter_usage where meter_id = g and read_date = d - 2) = 450, 'daily use = difference';
  assert (select days from public.meter_usage where meter_id = g and read_date = d) = 2, 'gap of 2 days reported';
  assert (select used from public.meter_usage where meter_id = g and read_date = d - 3) is null, 'first reading has no use';
  begin
    insert into public.meter_readings (meter_id, read_date, value) values (g, d - 1, 900);
    raise exception 'lower than previous should fail';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.meter_readings (meter_id, read_date, value) values (g, d - 1, 3000);
    raise exception 'higher than next day should fail';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.meter_readings (meter_id, read_date, value) values (g, d + 1, 3000);
    raise exception 'future date should fail';
  exception when sqlstate 'P0001' then null;
  end;
  insert into public.meter_readings (meter_id, read_date, value, is_reset, comment) values (g, d - 1, 20, true, 'Meter replaced');
  assert (select used from public.meter_usage where meter_id = g and read_date = d - 1) = 20, 'reset: use counts from zero';
  insert into public.meter_readings (meter_id, read_date, value) values (rt, d, 2500), (rt, d - 1, 3100);
  assert (select used from public.meter_usage where meter_id = rt and read_date = d) is null, 'rates are not differenced';
  assert (select reading_for from public.meter_readings where meter_id = g and read_date = d) = public.lagos_ts(d, time '07:00'), '7 am reading';
end $$;
rollback;
