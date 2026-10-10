-- Job requests / POs and item orders (JOB_REQUEST_INVENTORY.xlsx).
-- Status moves forward over time (offer → PO → execution → JCC → payment); every change is audit-logged.

create table public.job_requests (
  id                uuid primary key default gen_random_uuid(),
  sn                int,
  request_date      date,
  cs_number         text,
  description       text not null,
  brk_number        text,
  status            text not null default 'Pending' check (status in
                      ('Pending', 'Request for offer', 'Approved in BC', 'PO issued', 'CAPEX PO issued', 'Suspended', 'Abandoned')),
  po_number         text,
  po_value_ngn      numeric check (po_value_ngn is null or po_value_ngn >= 0),
  vendor            text,
  execution         text check (execution in ('Pending', 'In progress', 'Done')),
  jcc_completed     boolean not null default false,
  payment_completed boolean not null default false,
  remarks           text,
  area              public.area_code,
  asset_id          uuid references public.assets (id),
  import_key        text unique,
  recorded_by_type  text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id    uuid,
  recorded_at       timestamptz not null default now(),
  reading_for       timestamptz,
  updated_at        timestamptz not null default now(),
  voided_at         timestamptz,
  void_reason       text,
  is_demo           boolean not null default false
);

create table public.item_orders (
  id                uuid primary key default gen_random_uuid(),
  sn                int,
  order_date        date,
  mrs_number        text,
  items             text not null,
  prn_number        text,
  status            text not null default 'Pending' check (status in
                      ('Pending', 'Request for offer', 'Approved in BC', 'PO issued', 'CAPEX PO issued', 'Suspended', 'Abandoned')),
  po_number         text,
  po_value_ngn      numeric check (po_value_ngn is null or po_value_ngn >= 0),
  vendor            text,
  received_date     date,
  remarks           text,
  import_key        text unique,
  recorded_by_type  text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id    uuid,
  recorded_at       timestamptz not null default now(),
  reading_for       timestamptz,
  updated_at        timestamptz not null default now(),
  voided_at         timestamptz,
  void_reason       text,
  is_demo           boolean not null default false
);

create trigger job_requests_stamp before insert on public.job_requests for each row execute function public.stamp_recorded();
create trigger item_orders_stamp before insert on public.item_orders for each row execute function public.stamp_recorded();
create trigger job_requests_touch before update on public.job_requests for each row execute function public.touch_updated_at();
create trigger item_orders_touch before update on public.item_orders for each row execute function public.touch_updated_at();
-- who/when of the original entry never changes
create or replace function public.keep_record_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.recorded_by_type := old.recorded_by_type; new.recorded_by_id := old.recorded_by_id;
  new.recorded_at := old.recorded_at; new.import_key := old.import_key; new.is_demo := old.is_demo;
  return new;
end;
$$;
create trigger job_requests_keep_stamp before update on public.job_requests for each row execute function public.keep_record_stamp();
create trigger item_orders_keep_stamp before update on public.item_orders for each row execute function public.keep_record_stamp();
select public.enable_audit('public.job_requests', false);
select public.enable_audit('public.item_orders', false);

create or replace function public.void_job_record(p_table text, p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can void these records.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Give a reason (5+ characters).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(p_reason);
  if p_table = 'job_requests' then
    update public.job_requests set voided_at = now(), void_reason = p_reason where id = p_id and voided_at is null;
  elsif p_table = 'item_orders' then
    update public.item_orders set voided_at = now(), void_reason = p_reason where id = p_id and voided_at is null;
  else
    raise exception 'Unknown table.' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.void_job_record(text, uuid, text) from public, anon;

-- Import from the Excel tracker, tagged to the EXCEL-IMPORT logger. Re-running updates the same rows.
create or replace function public.load_job_data(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lg uuid;
  nj int; no int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can import job data.' using errcode = 'P0001';
  end if;
  insert into public.loggers (name, description) values ('EXCEL-IMPORT', 'Rows imported from the section''s Excel trackers')
  on conflict (name) do nothing;
  select id into lg from public.loggers where name = 'EXCEL-IMPORT';

  insert into public.job_requests (sn, request_date, cs_number, description, brk_number, status, po_number, po_value_ngn,
                                   vendor, execution, jcc_completed, payment_completed, remarks, import_key,
                                   recorded_by_type, recorded_by_id, reading_for)
  select (j->>'sn')::int, (j->>'date')::date, j->>'cs', j->>'desc', j->>'brk', j->>'status', j->>'po',
         (j->>'value')::numeric, j->>'vendor', j->>'exec', coalesce((j->>'jcc')::boolean, false),
         coalesce((j->>'paid')::boolean, false), j->>'remarks',
         'xls:job:' || (j->>'sn') || ':' || md5(j->>'desc'), 'logger', lg, (j->>'date')::date
    from jsonb_array_elements(p->'jobs') j
  on conflict (import_key) do update
     set status = excluded.status, po_number = excluded.po_number, po_value_ngn = excluded.po_value_ngn,
         vendor = excluded.vendor, execution = excluded.execution, jcc_completed = excluded.jcc_completed,
         payment_completed = excluded.payment_completed, remarks = excluded.remarks;
  get diagnostics nj = row_count;

  insert into public.item_orders (sn, order_date, mrs_number, items, prn_number, status, po_number, po_value_ngn, vendor,
                                  remarks, import_key, recorded_by_type, recorded_by_id, reading_for)
  select (o->>'sn')::int, (o->>'date')::date, o->>'mrs', o->>'items', o->>'prn', o->>'status', o->>'po',
         (o->>'value')::numeric, o->>'vendor', o->>'remarks',
         'xls:order:' || (o->>'sn') || ':' || md5(o->>'items'), 'logger', lg, (o->>'date')::date
    from jsonb_array_elements(p->'orders') o
  on conflict (import_key) do update
     set status = excluded.status, po_number = excluded.po_number, po_value_ngn = excluded.po_value_ngn,
         vendor = excluded.vendor, remarks = excluded.remarks;
  get diagnostics no = row_count;
  return jsonb_build_object('job_requests', nj, 'item_orders', no);
end;
$$;
revoke execute on function public.load_job_data(jsonb) from public, anon, authenticated;

alter table public.job_requests enable row level security;
alter table public.item_orders enable row level security;
revoke all on public.job_requests, public.item_orders from anon;

create policy job_requests_read on public.job_requests for select to authenticated using (true);
create policy job_requests_insert on public.job_requests for insert to authenticated
  with check (public.is_engineer_or_above() and recorded_by_type = 'person' and not is_demo);
create policy job_requests_update on public.job_requests for update to authenticated
  using (public.is_engineer_or_above() and voided_at is null) with check (public.is_engineer_or_above());

create policy item_orders_read on public.item_orders for select to authenticated using (true);
create policy item_orders_insert on public.item_orders for insert to authenticated
  with check (public.is_engineer_or_above() and recorded_by_type = 'person' and not is_demo);
create policy item_orders_update on public.item_orders for update to authenticated
  using (public.is_engineer_or_above() and voided_at is null) with check (public.is_engineer_or_above());
