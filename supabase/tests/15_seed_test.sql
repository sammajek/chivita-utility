-- The seed loaded everything and every field points at a parameter.
do $$ begin
  assert (select count(*) from public.assets) = 93, 'assets loaded';
  assert (select count(*) from public.parameters) = 251, 'parameters loaded';
  assert (select count(*) from public.registers) = 28, 'registers loaded';
  assert (select count(*) from public.register_fields) = 428, 'fields loaded';
  assert (select count(*) from public.asset_aliases where not confirmed) > 0, 'unconfirmed aliases for review';
  assert not exists (select 1 from public.register_sections where slot_kind = 'time' and slot_times is null), 'time sections have slots';
  assert (select count(*) from public.parameters where needs_review) > 10, 'conflicts flagged for review';
end $$;
-- Re-running the loader is harmless.
select public.load_master_data('{"assets":[{"code":"BLR-01","name":"changed","category":"Boilers"}]}');
do $$ begin
  assert (select name from public.assets where code = 'BLR-01') = 'Boiler 1 (LOOS)', 'reload never overwrites';
end $$;
