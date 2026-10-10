-- clear_demo_data (0012) predates PM; PM demo rows are removed here.
create or replace function public.clear_pm_demo()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can clear demo data.' using errcode = 'P0001';
  end if;
  delete from public.flags where kind = 'pm_followup' and is_demo;
  delete from public.pm_completions where is_demo;
end;
$$;
revoke execute on function public.clear_pm_demo() from public, anon;

