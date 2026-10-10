-- Job requests and item orders: import, RLS, status updates audited, void with reason.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'jobop@test.local'),
  ('00000000-0000-0000-0000-0000000000a8', 'jobeng@test.local');
update public.profiles set role = 'operator', active = true where email = 'jobop@test.local';
update public.profiles set role = 'engineer', active = true where email = 'jobeng@test.local';

do $$ begin
  assert (select count(*) from public.job_requests) = 42, '42 job requests imported';
  assert (select count(*) from public.item_orders) = 8, '8 item orders imported';
  assert (select count(*) from public.job_requests where recorded_by_type = 'logger') = 42, 'tagged to the import logger';
  assert (select sum(po_value_ngn) from public.job_requests) > 50000000, 'PO values imported';
  -- re-import is idempotent
  perform public.load_job_data('{"jobs":[],"orders":[]}'::jsonb);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', true);
do $$ begin
  begin
    insert into public.job_requests (description) values ('x');
    raise exception 'operator insert should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', true);
do $$
declare j public.job_requests;
begin
  insert into public.job_requests (request_date, description, status) values (current_date, 'Rewind feed pump motor', 'Pending')
  returning * into j;
  assert j.recorded_by_id = auth.uid(), 'stamped to engineer';
  update public.job_requests set status = 'PO issued', po_number = 'PO999', po_value_ngn = 450000, recorded_by_id = null
   where id = j.id returning * into j;
  assert j.status = 'PO issued' and j.recorded_by_id = auth.uid(), 'status updated, original stamp kept';
  perform public.void_job_record('job_requests', j.id, 'Duplicate of MCS11300');
  assert (select voided_at is not null from public.job_requests where id = j.id), 'voided';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.audit_log where table_name = 'job_requests' and action in ('update', 'void')) >= 2, 'changes audited';
end $$;
rollback;
