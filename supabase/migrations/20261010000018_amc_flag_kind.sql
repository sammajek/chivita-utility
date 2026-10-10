-- AMC past-due flag kind (kept separate: the constraint is replaced).
alter table public.flags add column amc_contract_id uuid references public.amc_contracts (id);
alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue', 'pm_overdue', 'pm_followup',
  'amc_past_due'));
