-- PM flag kinds (kept separate: the constraint is replaced).

alter table public.flags add column pm_task_id uuid references public.pm_tasks (id);
alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue', 'pm_overdue', 'pm_followup'));

