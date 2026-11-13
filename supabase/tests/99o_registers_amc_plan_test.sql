-- Trane Chiller 3 is on the Trane register, Degasser 3 on the General Log Report, and a year of AMC months can be set at once.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ae', 'amcadmin@test.local');
update public.profiles set role = 'admin', active = true where email = 'amcadmin@test.local';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ae', true);
do $$
declare c uuid; n int;
begin
  assert exists (select 1 from public.register_assets ra join public.registers r on r.id = ra.register_id join public.assets a on a.id = ra.asset_id
                  where r.title = 'Trane Chiller Log Report' and a.code = 'CHT-03' and ra.active), 'CHT-03 on Trane register';
  assert exists (select 1 from public.register_fields f join public.assets a on a.id = f.asset_id
                  where a.code = 'DGS-03' and f.label = 'Degasser 3 Blower Operation'), 'Degasser 3 field';
  select id into c from public.amc_contracts where active limit 1;
  perform public.set_amc_plan_year(c, 2031, array[1, 4, 7, 10]);
  select count(*) into n from public.amc_schedule where contract_id = c and planned and month between '2031-01-01' and '2031-12-01';
  assert n = 4, format('4 planned, got %s', n);
  perform public.set_amc_plan_year(c, 2031, array[2]);
  select count(*) into n from public.amc_schedule where contract_id = c and planned and month between '2031-01-01' and '2031-12-01';
  assert n = 1, format('1 planned, got %s', n);
end $$;
rollback;
