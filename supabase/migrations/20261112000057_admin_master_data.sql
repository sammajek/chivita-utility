-- Admin can maintain more master data (owner, 2026-11-12): cleaning zones and activities (edit, add, retire),
-- register machine lists (switch a machine on / off a register — now also recorded in the audit trail).
-- Utility 2 has never had nitrogen generators: its nitrogen log stays off.

alter table public.cleaning_zones add column if not exists active boolean not null default true;
alter table public.cleaning_activities add column if not exists active boolean not null default true;
select public.enable_audit('public.cleaning_zones', false);
select public.enable_audit('public.cleaning_activities', false);
create policy cleaning_zones_admin_write on public.cleaning_zones for all to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));
create policy cleaning_activities_admin_write on public.cleaning_activities for all to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));
grant usage on sequence public.cleaning_zones_id_seq, public.cleaning_activities_id_seq to authenticated;

create or replace function public.audit_register_assets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (table_name, record_id, action, changed_by, changed_fields, old_data, new_data, reason)
  values ('register_assets',
          coalesce(new.register_id, old.register_id)::text || ':' || coalesce(new.asset_id, old.asset_id)::text,
          case tg_op when 'INSERT' then 'insert' when 'UPDATE' then 'update' else 'void' end,
          auth.uid(),
          case when tg_op = 'UPDATE' then array['active'] end,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(current_setting('app.change_reason', true), ''));
  return coalesce(new, old);
end;
$$;
revoke execute on function public.audit_register_assets() from public, anon, authenticated;
drop trigger if exists audit_register_assets on public.register_assets;
create trigger audit_register_assets after insert or update or delete on public.register_assets
  for each row execute function public.audit_register_assets();

update public.registers set description = '[Off: Utility 2 has never had nitrogen generators (owner, 2026-11-12).]'
 where area = 'U2' and title = 'Nitrogen Generator Log Report';
