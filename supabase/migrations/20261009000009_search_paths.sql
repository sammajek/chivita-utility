-- Pin search_path on the helper functions added with the operations schema (Supabase advisor).
alter function public.slot_due(public.slot_kind, date, text) set search_path = public;
alter function public.lagos_ts(date, time) set search_path = public;
alter function public.lagos_now() set search_path = public;
alter function public.log_date_of(timestamptz) set search_path = public;
alter function public.downtime_hours(public.downtime_events) set search_path = public;
