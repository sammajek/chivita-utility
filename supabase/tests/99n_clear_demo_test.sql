-- Clearing demo data removes only DEMO rows and what depends on them.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000dd', 'cleardemo@test.local');
select public.generate_consumption_demo('00000000-0000-0000-0000-0000000000dd', 3);
do $$ declare r jsonb;
begin
  assert exists (select 1 from public.meter_readings where is_demo), 'demo present';
  r := public.clear_demo_data_all();
  assert not exists (select 1 from public.meter_readings where is_demo), format('demo cleared %s', r);
end $$;
rollback;
