-- Outage response (app or internet down): declare an outage, log on paper, back-enter later.
-- While an outage is open, and for a back-entry window after it ends, no "missing reading" flags are raised.
-- Back-entered readings are marked entry_method = 'paper' and linked to the outage.
-- Documents: attachments get a document type, and instruments (calibration) can hold documents.

alter table public.readings drop constraint readings_entry_method_check;
alter table public.readings add constraint readings_entry_method_check
  check (entry_method in ('manual', 'photo', 'logger', 'paper'));
comment on column public.readings.entry_method is
  'manual = typed; photo = read from an HMI photo and confirmed; logger = data logger; paper = copied from a paper sheet after an outage.';

create table public.system_outages (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null,
  ended_at         timestamptz,
  reason           text not null check (length(trim(reason)) >= 3),
  area             public.area_code,
  end_note         text,
  ended_by         uuid references auth.users (id),
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  is_demo          boolean not null default false,
  check (ended_at is null or ended_at >= started_at)
);
create unique index system_outages_one_open on public.system_outages ((true)) where ended_at is null;
create trigger system_outages_stamp before insert on public.system_outages for each row execute function public.stamp_recorded();
select public.enable_audit('public.system_outages', false);

insert into public.app_settings (key, value, description) values
  ('outage_backfill_hours', '24'::jsonb,
   'Hours after an outage ends during which paper readings can be back-entered before missing-reading flags are raised.')
on conflict (key) do nothing;

-- Engineers and above declare the outage when it starts (or as soon as they can get online: started_at may be in the past).
create or replace function public.declare_outage(p_reason text, p_started_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can declare an outage.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.system_outages where ended_at is null) then
    raise exception 'An outage is already open.' using errcode = 'P0001';
  end if;
  if p_started_at > now() + interval '5 minutes' or p_started_at < now() - interval '7 days' then
    raise exception 'The start time must be within the last 7 days.' using errcode = 'P0001';
  end if;
  insert into public.system_outages (started_at, reason, recorded_by_type, reading_for)
  values (least(p_started_at, now()), p_reason, 'person', least(p_started_at, now()))
  returning id into new_id;
  return new_id;
end;
$$;
revoke execute on function public.declare_outage(text, timestamptz) from public, anon;

create or replace function public.end_outage(p_id uuid, p_ended_at timestamptz, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can end an outage.' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(coalesce(nullif(trim(p_note), ''), 'Outage ended'));
  update public.system_outages
     set ended_at = greatest(started_at, least(coalesce(p_ended_at, now()), now())), ended_by = auth.uid(),
         end_note = nullif(trim(p_note), '')
   where id = p_id and ended_at is null;
  if not found then raise exception 'Open outage not found.' using errcode = 'P0001'; end if;
end;
$$;
revoke execute on function public.end_outage(uuid, timestamptz, text) from public, anon;

-- The outage covering a moment, if its back-entry window is still open.
create or replace function public.outage_covering(p_at timestamptz)
returns uuid
language sql
stable
set search_path = public
as $$
  select o.id from public.system_outages o
   where o.started_at <= p_at and (o.ended_at is null or o.ended_at >= p_at)
     and (o.ended_at is null
          or now() < o.ended_at + make_interval(hours => public.setting_num('outage_backfill_hours', 24)::int))
   order by o.started_at desc limit 1
$$;

-- Slots falling inside an outage (until its back-entry window closes) expect no machines → no missing flags.
create or replace function public.slot_expected_assets(p_section uuid, p_due timestamptz)
returns table (asset_id uuid)
language sql
stable
set search_path = public
as $$
  with sec as (select * from public.register_sections where id = p_section),
  pinned as (select distinct f.asset_id from public.register_fields f where f.section_id = p_section and f.active and f.asset_id is not null),
  shared as (select ra.asset_id from public.register_assets ra join sec on ra.register_id = sec.register_id
              where exists (select 1 from public.register_fields f where f.section_id = p_section and f.active and f.asset_id is null))
  select a.asset_id from (select asset_id from pinned union select asset_id from shared) a
   where public.outage_covering(p_due) is null
     and not exists (select 1 from public.downtime_events e
                      where e.asset_id = a.asset_id and e.voided_at is null and e.start_at <= p_due
                        and (e.end_at is null or e.end_at >= p_due))
     and not exists (select 1 from public.asset_states s
                      where s.asset_id = a.asset_id and s.state <> 'available' and s.started_at <= p_due
                        and (s.ended_at is null or s.ended_at >= p_due))
$$;

-- Readings for a slot inside an outage are linked to it (so lateness is explained in compliance reports).
alter table public.readings add column outage_id uuid references public.system_outages (id);
create or replace function public.readings_link_outage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.outage_id := (select o.id from public.system_outages o
                     where o.started_at <= new.reading_for and (o.ended_at is null or o.ended_at >= new.reading_for)
                     order by o.started_at desc limit 1);
  return new;
end;
$$;
revoke execute on function public.readings_link_outage() from public, anon, authenticated;
-- "readings_z…" fires after readings_before_write (triggers run in name order), once reading_for is final.
create trigger readings_zz_link_outage before insert on public.readings
  for each row execute function public.readings_link_outage();

-- ---------------------------------------------------------------- Documents
alter table public.attachments add column doc_type text check (doc_type in (
  'Photo', 'Manual', 'Datasheet', 'Drawing', 'Certificate', 'Calibration certificate', 'PM checklist',
  'Service report', 'Test report', 'Other'));
alter table public.attachments drop constraint attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check check (entity_type in (
  'downtime', 'followup', 'pm_completion', 'pm_affirmation', 'cleaning', 'rca', 'asset', 'water_result', 'calibration',
  'instrument', 'job_request', 'external_report', 'training', 'outage'));

alter table public.system_outages enable row level security;
revoke all on public.system_outages from anon;
create policy system_outages_read on public.system_outages for select to authenticated using (public.is_active_user());
-- writes go through declare_outage / end_outage
