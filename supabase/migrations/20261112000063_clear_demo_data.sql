-- Clear all DEMO practice data before go-live (owner, 2026-11-12). Only rows marked is_demo are removed, plus the
-- records that only exist because of them (flags about demo readings, follow-ups on demo downtime, spot-checks of demo
-- PM, photos on demo records). Real records are never touched. The demo logins are deactivated (not deleted).
create or replace function public.clear_demo_data_all()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare out jsonb := '{}'; n int;
  dt uuid[] := array(select id from downtime_events where is_demo);
  rc uuid[] := array(select id from rcas where is_demo or downtime_id = any (array(select id from downtime_events where is_demo)));
  pc uuid[] := array(select id from pm_completions where is_demo);
  ins uuid[] := array(select id from instruments where is_demo);
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can clear demo data.' using errcode = 'P0001';
  end if;
  perform set_config('app.purge_never_existed', 'on', true);   -- dependent non-demo rows (audited as removals)
  perform public.set_change_reason('DEMO data cleared before go-live');

  delete from flags where is_demo or downtime_id = any (dt) or rca_id = any (rc) or instrument_id = any (ins)
     or reading_id in (select id from readings where is_demo) or water_result_id in (select id from water_results where is_demo);
  get diagnostics n = row_count; out := out || jsonb_build_object('flags', n);
  delete from attachments where entity_id = any (dt || rc || pc || ins);
  delete from pm_spot_checks where completion_id = any (pc);
  delete from downtime_followups where downtime_id = any (dt);
  update asset_states set downtime_id = null where downtime_id = any (dt);
  delete from rcas where id = any (rc);                 get diagnostics n = row_count; out := out || jsonb_build_object('rcas', n);
  delete from downtime_events where id = any (dt);      get diagnostics n = row_count; out := out || jsonb_build_object('downtime', n);
  delete from readings where is_demo;                   get diagnostics n = row_count; out := out || jsonb_build_object('readings', n);
  delete from pm_completions where id = any (pc);       get diagnostics n = row_count; out := out || jsonb_build_object('pm', n);
  delete from calibrations where is_demo or instrument_id = any (ins);
  delete from instruments where id = any (ins);         get diagnostics n = row_count; out := out || jsonb_build_object('instruments', n);
  delete from water_results where is_demo;              get diagnostics n = row_count; out := out || jsonb_build_object('water', n);
  delete from meter_readings where is_demo;             get diagnostics n = row_count; out := out || jsonb_build_object('meter_readings', n);
  delete from cleaning_checks where is_demo;
  delete from cleaning_signoffs where is_demo;
  delete from amc_visits where is_demo;
  delete from handovers where duty_session_id in (select id from duty_sessions where is_demo);
  delete from duty_sessions where is_demo;

  update profiles set active = false where email like '%.demo@chi-utility.test';
  get diagnostics n = row_count; out := out || jsonb_build_object('demo_logins_deactivated', n);
  perform set_config('app.purge_never_existed', 'off', true);
  return out;
end;
$$;
revoke execute on function public.clear_demo_data_all() from public, anon, authenticated;
