-- The Utility 1 copy of "Chiller Logbook Thermax (THDC2)" is removed (owner, 2026-11-12): VAM 4 is in Utility 2.
select public.purge_never_existed_register(id, 'Utility 1 copy of the THDC2 logbook: VAM 4 is in Utility 2 (owner, 2026-11-12)')
  from public.registers where area = 'U1' and title = 'Chiller Logbook Thermax (THDC2)';
