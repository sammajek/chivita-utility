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
