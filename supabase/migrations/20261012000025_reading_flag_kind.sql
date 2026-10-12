-- Early-entry flag kind and slot columns on flags (kept separate: the constraint is replaced).
alter table public.flags add column section_id uuid references public.register_sections (id);
alter table public.flags add column log_date date;
alter table public.flags add column slot_key text;
alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'reading_early', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue',
  'pm_overdue', 'pm_followup', 'amc_past_due', 'water_alert', 'water_action', 'calibration_due'));
create index flags_slot_idx on public.flags (section_id, log_date, slot_key) where kind = 'reading_missing';
