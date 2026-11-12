-- The seed loaded everything and every field points at a parameter.
do $$ begin
  assert (select count(*) from public.assets) = 92, 'assets: 93 + 7 Utility 2 additions - 8 that never existed (owner)';
  assert (select count(*) from public.parameters) = 252, 'parameters loaded (251 + VAM gas running hours)';
  assert (select count(*) from public.registers) = 26, 'registers loaded (28 - Utility 2 nitrogen log - Utility 1 THDC2 copy)';
  assert (select count(*) from public.register_fields) between 300 and 429, 'fields loaded (428 + VAM gas running hours, minus removed registers)';
  assert (select count(*) from public.asset_aliases where not confirmed) > 0, 'unconfirmed aliases for review';
  assert not exists (select 1 from public.register_sections where slot_kind = 'time' and slot_times is null), 'time sections have slots';
  assert (select count(*) from public.parameters where needs_review) > 10, 'conflicts flagged for review';
end $$;
-- Re-running the loader is harmless.
select public.load_master_data('{"assets":[{"code":"BLR-01","name":"changed","category":"Boilers"}]}');
do $$ begin
  assert (select name from public.assets where code = 'BLR-01') = 'Boiler 1 (Loos)', 'reload never overwrites';
end $$;
