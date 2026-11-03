-- Report summaries run and return sane shapes.
begin;
do $$
declare n int;
begin
  update public.registers set monitor = true;
  select count(*) into n from public.report_reading_summary(now() - interval '7 days', now(), null);
  assert n = (select count(*) from public.registers), 'one row per monitored register';
  select count(*) into n from public.report_reading_summary(now() - interval '7 days', now(), 'U2');
  assert n = (select count(*) from public.registers where area = 'U2'), 'area filter';
  assert not exists (select 1 from public.report_pm_summary(current_date - 30, current_date, null) where done_ok + done_not_ok + not_done > due), 'done never exceeds due';
end $$;
rollback;
