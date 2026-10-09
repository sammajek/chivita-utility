-- Security hardening from the Supabase advisor:
-- * pin search_path on every function
-- * trigger functions are not callable over the API
-- * helper functions are callable by signed-in users only

alter function public.enable_audit(regclass, boolean) set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.set_change_reason(text) set search_path = public;
alter function public.is_engineer_or_above() set search_path = public;
alter function public.is_manager_or_admin() set search_path = public;

-- Trigger-only functions: nobody calls these directly (triggers still fire).
revoke execute on function public.audit_row_change() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.stamp_recorded() from public, anon, authenticated;
revoke execute on function public.enable_audit(regclass, boolean) from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Signed-in only (RLS policies evaluate these as the calling user).
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.has_role(public.app_role[]) from public, anon;
revoke execute on function public.is_engineer_or_above() from public, anon;
revoke execute on function public.is_manager_or_admin() from public, anon;
revoke execute on function public.update_my_contact(text, text) from public, anon;
revoke execute on function public.set_change_reason(text) from public, anon;

-- New functions default to signed-in-only execute.
alter default privileges in schema public revoke execute on functions from public, anon;
