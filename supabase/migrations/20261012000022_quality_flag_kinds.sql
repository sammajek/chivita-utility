-- Water-quality and calibration flag kinds (kept separate: the constraint is replaced).
alter table public.flags add column water_result_id uuid references public.water_results (id);
alter table public.flags add column instrument_id uuid references public.instruments (id);
alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue', 'pm_overdue', 'pm_followup',
  'amc_past_due', 'water_alert', 'water_action', 'calibration_due'));
