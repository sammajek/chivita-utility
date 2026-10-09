-- Remove everything marked is_demo (demo rows may be deleted; real rows never).
create or replace function public.clear_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can clear demo data.' using errcode = 'P0001';
  end if;
  delete from public.flags where is_demo or reading_id in (select id from public.readings where is_demo)
                              or downtime_id in (select id from public.downtime_events where is_demo)
                              or rca_id in (select id from public.rcas where is_demo);
  delete from public.rcas where is_demo;
  delete from public.readings where is_demo;
  delete from public.downtime_events where is_demo;
  delete from public.duty_sessions where is_demo;
end;
$$;
revoke execute on function public.clear_demo_data() from public, anon;
