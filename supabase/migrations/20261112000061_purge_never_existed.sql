-- Records for equipment that never existed are removed completely (owner, 2026-11-12); equipment that existed and was
-- decommissioned (e.g. Borehole 3) stays as "retired". Deletion is still blocked everywhere else: only this admin
-- function may delete, only machines with no real (non-demo) records, and every removed row is written to the audit log.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_j   jsonb;
  new_j   jsonb;
  fields  text[];
  reason  text := nullif(current_setting('app.change_reason', true), '');
  require_reason boolean := coalesce(tg_argv[0]::boolean, true);
  act     text;
begin
  if tg_op = 'DELETE' then
    if coalesce((to_jsonb(old) ->> 'is_demo')::boolean, false) then
      return old;  -- demo rows may be removed
    end if;
    if current_setting('app.purge_never_existed', true) = 'on' then   -- admin removal of things that never existed
      insert into public.audit_log (table_name, record_id, action, changed_by, old_data, reason)
      values (tg_table_name, old.id::text, 'void', auth.uid(), to_jsonb(old), coalesce(reason, 'Removed: never existed'));
      return old;
    end if;
    raise exception 'Records in % cannot be deleted. Void the record with a reason instead.', tg_table_name
      using errcode = 'P0001';
  end if;

  new_j := to_jsonb(new);
  if coalesce((new_j ->> 'is_demo')::boolean, false) then
    return new;  -- demo rows are not audited
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (table_name, record_id, action, changed_by, new_data)
    values (tg_table_name, new.id::text, 'insert', auth.uid(), new_j);
    return new;
  end if;

  old_j := to_jsonb(old);

  select array_agg(key order by key) into fields
  from jsonb_each(new_j) n
  where n.value is distinct from old_j -> n.key
    and n.key not in ('updated_at');

  if fields is null then
    return new;
  end if;

  if new_j ? 'voided_at' and (old_j ->> 'voided_at') is null and (new_j ->> 'voided_at') is not null then
    act := 'void';
    reason := coalesce(reason, new_j ->> 'void_reason');
  else
    act := 'update';
  end if;

  if require_reason and reason is null then
    raise exception 'A reason is required to change a submitted record in %.', tg_table_name
      using errcode = 'P0001';
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, changed_fields, old_data, new_data, reason)
  values (
    tg_table_name, new.id::text, act, auth.uid(), fields,
    (select jsonb_object_agg(k, old_j -> k) from unnest(fields) k),
    (select jsonb_object_agg(k, new_j -> k) from unnest(fields) k),
    reason
  );
  return new;
end;
$$;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

-- Remove machines that never existed. Refuses any machine with real (non-demo) readings, downtime, PM tasks, meters,
-- instruments, jobs or logger data: those existed and must be retired instead.
create or replace function public.purge_never_existed_assets(p_codes text[], p_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare ids uuid[]; n int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can remove equipment that never existed.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Give a reason (5+ characters).' using errcode = 'P0001'; end if;
  select array_agg(id) into ids from assets where code = any (p_codes);
  if ids is null then return 0; end if;
  if exists (select 1 from readings where asset_id = any (ids) and not is_demo)
     or exists (select 1 from downtime_events where asset_id = any (ids) and not is_demo)
     or exists (select 1 from pm_tasks where asset_id = any (ids))
     or exists (select 1 from meters where asset_id = any (ids))
     or exists (select 1 from instruments where asset_id = any (ids) and not is_demo)
     or exists (select 1 from job_requests where asset_id = any (ids))
     or exists (select 1 from logger_data where asset_id = any (ids)) then
    raise exception 'These machines have real records, so they existed: retire them instead.' using errcode = 'P0001';
  end if;
  perform set_config('app.purge_never_existed', 'on', true);
  perform public.set_change_reason('Removed (never existed): ' || trim(p_reason));
  delete from flags where asset_id = any (ids) or reading_id in (select id from readings where asset_id = any (ids));
  delete from readings where asset_id = any (ids);
  delete from downtime_events where asset_id = any (ids);
  delete from instruments where asset_id = any (ids);
  delete from asset_states where asset_id = any (ids);
  delete from asset_aliases where asset_id = any (ids);
  delete from register_fields where asset_id = any (ids);
  delete from register_assets where asset_id = any (ids);
  delete from service_intervals where asset_id = any (ids);
  delete from asset_scans where asset_id = any (ids);
  delete from asset_scan_codes where asset_id = any (ids);
  update patrol_points set asset_ids = array(select unnest(asset_ids) except select unnest(ids)) where asset_ids && ids;
  update amc_contracts set asset_ids = array(select unnest(asset_ids) except select unnest(ids)) where asset_ids && ids;
  delete from assets where id = any (ids);
  get diagnostics n = row_count;
  perform set_config('app.purge_never_existed', 'off', true);
  return n;
end;
$$;
revoke execute on function public.purge_never_existed_assets(text[], text) from public, anon;

-- Remove a register that never applied (no machines, no real readings).
create or replace function public.purge_never_existed_register(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can remove a register.' using errcode = 'P0001';
  end if;
  if exists (select 1 from readings where register_id = p_id and not is_demo) then
    raise exception 'This register has real readings: switch it off instead.' using errcode = 'P0001';
  end if;
  perform set_config('app.purge_never_existed', 'on', true);
  perform public.set_change_reason('Removed (never existed): ' || trim(p_reason));
  delete from flags where register_id = p_id or reading_id in (select id from readings where register_id = p_id);
  delete from readings where register_id = p_id;
  delete from register_fields where section_id in (select id from register_sections where register_id = p_id);
  delete from register_sections where register_id = p_id;
  delete from register_assets where register_id = p_id;
  delete from registers where id = p_id;
  perform set_config('app.purge_never_existed', 'off', true);
end;
$$;
revoke execute on function public.purge_never_existed_register(uuid, text) from public, anon;

-- The owner's list (2026-11-12).
select public.purge_never_existed_assets(
  array['N2G-U2-01', 'N2G-U2-02', 'DRY-11', 'DRY-12', 'BLR-06', 'BLR-07', 'CMP-13', 'CMP-AC1', 'CHV-U2'],
  'Never existed: Utility 2 nitrogen generators, Air Dryer 11, IR TMS dryer and duplicate entries (owner, 2026-11-12)');
select public.purge_never_existed_register(id, 'Utility 2 has never had nitrogen generators (owner, 2026-11-12)')
  from public.registers where area = 'U2' and title = 'Nitrogen Generator Log Report';
