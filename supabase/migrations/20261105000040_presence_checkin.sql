-- Proof of presence: each control room has a secret code printed as a QR label inside the room. Scanning it when
-- checking in marks the duty session "verified in control room". An admin can issue a new code (reprint the label)
-- at any time; old printouts then stop working. Only a hash of the code is stored.

create table public.control_rooms (
  area        public.area_code primary key,
  code_hash   text not null,
  issued_at   timestamptz not null default now(),
  issued_by   uuid references auth.users (id)
);
alter table public.control_rooms enable row level security;
revoke all on public.control_rooms from anon, authenticated;   -- only reached through the functions below

alter table public.duty_sessions add column presence_verified_at timestamptz;
alter table public.duty_sessions add column presence_area public.area_code;
comment on column public.duty_sessions.presence_verified_at is 'When the person scanned the control-room QR code during this shift.';

create or replace function public.issue_checkin_code(p_area public.area_code)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare k text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.has_role('admin', 'section_manager') then
    raise exception 'Only an admin or the section manager can issue control-room codes.' using errcode = 'P0001';
  end if;
  insert into control_rooms (area, code_hash, issued_at, issued_by)
  values (p_area, encode(sha256(convert_to(k, 'UTF8')), 'hex'), now(), auth.uid())
  on conflict (area) do update set code_hash = excluded.code_hash, issued_at = now(), issued_by = auth.uid();
  return k;
end;
$$;
revoke execute on function public.issue_checkin_code(public.area_code) from public, anon;

-- Marks my current-shift session as verified in that control room (checks me in for that area if I am not yet).
create or replace function public.verify_presence(p_area public.area_code, p_code text)
returns public.duty_sessions
language plpgsql
security definer
set search_path = public
as $$
declare cs record; r public.duty_sessions;
begin
  if not exists (select 1 from control_rooms where area = p_area
                  and code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')) then
    raise exception 'This control-room code is not valid (it may have been replaced). Check in normally and tell the section manager.'
      using errcode = 'P0001';
  end if;
  select * into cs from public.current_shift();
  select * into r from duty_sessions where profile_id = auth.uid() and shift_date = cs.shift_date and shift = cs.shift;
  if r.id is null or r.checked_out_at is not null then
    r := public.check_in(array[p_area]);
  elsif not (p_area = any (r.areas)) then
    update duty_sessions set areas = array_append(areas, p_area) where id = r.id returning * into r;
  end if;
  update duty_sessions set presence_verified_at = now(), presence_area = p_area where id = r.id returning * into r;
  return r;
end;
$$;
revoke execute on function public.verify_presence(public.area_code, text) from public, anon;

create or replace function public.checkin_codes_status()
returns table (area public.area_code, issued_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$ select area, issued_at from control_rooms where public.is_active_user() order by area $$;
revoke execute on function public.checkin_codes_status() from public, anon;
