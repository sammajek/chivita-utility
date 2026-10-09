-- Schedule the flag + escalation job every 5 minutes with pg_cron (Supabase).
-- Skipped on databases without pg_cron (e.g. the local test database).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('chi-flag-job', '*/5 * * * *', 'select public.run_flag_job()');
  end if;
end $$;
