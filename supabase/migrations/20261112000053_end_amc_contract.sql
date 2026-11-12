-- End an AMC contract (vendor no longer does the AMC): off the tracker, no more flags, open past-due flags closed.
-- Nothing is deleted; the visit history stays and the contract can be brought back.
create or replace function public.end_amc_contract(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare today date := public.lagos_now()::date;
begin
  if not public.has_role('admin', 'section_manager') then raise exception 'Only managers can end an AMC contract.' using errcode = 'P0001'; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Give a reason (5+ characters).' using errcode = 'P0001'; end if;
  perform public.set_change_reason('AMC contract ended: ' || trim(p_reason));
  update amc_contracts set active = false, end_date = today,
         notes = concat_ws(' · ', nullif(notes, ''), format('Ended %s: %s', today, trim(p_reason)))
   where id = p_id and active;
  if not found then raise exception 'Contract not found or already ended.' using errcode = 'P0001'; end if;
  update flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'AMC contract ended'
   where amc_contract_id = p_id and resolved_at is null;
end;
$$;
revoke execute on function public.end_amc_contract(uuid, text) from public, anon;
