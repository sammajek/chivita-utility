-- CHI Utility Ops: foundation
-- Roles, user profiles, audit trail and the record-tagging convention every
-- operational table follows. See CLAUDE.md "Ground rules".

-- ---------------------------------------------------------------------------
-- Roles and profiles
-- ---------------------------------------------------------------------------

create type public.app_role as enum (
  'operator',
  'engineer',
  'shift_manager',
  'section_manager',
  'admin',
  'viewer'
);

create type public.area_code as enum ('U1', 'U2');

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete restrict,
  full_name     text not null,
  staff_id      text unique,
  email         text,
  phone         text,
  whatsapp      text,
  role          public.app_role not null default 'viewer',
  areas         public.area_code[] not null default '{U1,U2}',
  default_shift text check (default_shift in ('day', 'night')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'One row per app user. role drives permissions; areas limits which Utility area they work in.';

-- Current user's role. security definer so RLS policies can call it without
-- recursing into profiles' own policies.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

-- Engineers and above may approve, close downtime and run RCA.
create or replace function public.is_engineer_or_above()
returns boolean
language sql
stable
as $$
  select public.has_role('engineer', 'shift_manager', 'section_manager', 'admin')
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql
stable
as $$
  select public.has_role('shift_manager', 'section_manager', 'admin')
$$;

-- New auth users get a profile automatically (role viewer until an admin promotes them).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
-- Submitted records are never silently edited or deleted. Every UPDATE on an
-- audited table writes old/new values, who, when and why. DELETE is blocked:
-- void the record instead (voided_at / voided_by / void_reason).
--
-- The reason for a change is read from the transaction setting
-- app.change_reason, which the amend_* / void_* RPC functions set. Direct
-- updates without a reason are rejected on tables that require one.

create table public.audit_log (
  id             bigint generated always as identity primary key,
  table_name     text not null,
  record_id      text not null,
  action         text not null check (action in ('insert', 'update', 'void')),
  changed_by     uuid references auth.users (id),
  changed_at     timestamptz not null default now(),
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb,
  reason         text
);

create index audit_log_record_idx on public.audit_log (table_name, record_id, changed_at desc);
create index audit_log_changed_by_idx on public.audit_log (changed_by, changed_at desc);

comment on table public.audit_log is
  'Who changed what, when, from which value to which, and why. Append-only.';

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
    raise exception 'Records in % cannot be deleted. Void the record with a reason instead.', tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (table_name, record_id, action, changed_by, new_data)
    values (tg_table_name, new.id::text, 'insert', auth.uid(), to_jsonb(new));
    return new;
  end if;

  old_j := to_jsonb(old);
  new_j := to_jsonb(new);

  select array_agg(key order by key) into fields
  from jsonb_each(new_j) n
  where n.value is distinct from old_j -> n.key
    and n.key not in ('updated_at');

  if fields is null then
    return new;  -- nothing actually changed
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
    tg_table_name,
    new.id::text,
    act,
    auth.uid(),
    fields,
    (select jsonb_object_agg(k, old_j -> k) from unnest(fields) k),
    (select jsonb_object_agg(k, new_j -> k) from unnest(fields) k),
    reason
  );
  return new;
end;
$$;

-- Helper to attach the audit trigger. require_reason=false is used for master
-- data edited on admin screens (the change is still logged).
create or replace function public.enable_audit(tbl regclass, require_reason boolean default true)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger audit_row_change after insert or update on %s
       for each row execute function public.audit_row_change(%L)',
    tbl, require_reason
  );
  execute format(
    'create trigger block_delete before delete on %s
       for each row execute function public.audit_row_change(%L)',
    tbl, require_reason
  );
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

select public.enable_audit('public.profiles', false);

-- ---------------------------------------------------------------------------
-- Record tagging
-- ---------------------------------------------------------------------------
-- Operational tables carry:
--   recorded_by_type  'person' | 'logger'
--   recorded_by_id    profile id or logger id
--   recorded_at       server time, never the client clock
--   reading_for       the slot the record belongs to
-- This trigger enforces server time and, for people, the logged-in user.

create or replace function public.stamp_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.recorded_at := now();
  if new.recorded_by_type = 'person' then
    if auth.uid() is null then
      raise exception 'A person-tagged record needs a logged-in user.' using errcode = 'P0001';
    end if;
    new.recorded_by_id := auth.uid();
  elsif new.recorded_by_type = 'logger' then
    if new.recorded_by_id is null then
      raise exception 'A logger-tagged record needs recorded_by_id.' using errcode = 'P0001';
    end if;
  else
    raise exception 'recorded_by_type must be person or logger.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Set the change reason for the current transaction. Called by amend/void RPCs.
create or replace function public.set_change_reason(reason text)
returns void
language plpgsql
as $$
begin
  if reason is null or length(trim(reason)) < 3 then
    raise exception 'Please give a reason (at least 3 characters).' using errcode = 'P0001';
  end if;
  perform set_config('app.change_reason', reason, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_read on public.profiles
  for select to authenticated
  using (true);

create policy profiles_admin_write on public.profiles
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (public.has_role('admin'));

-- Users can update their own contact details but not their role, areas or status.
create or replace function public.update_my_contact(p_phone text, p_whatsapp text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set phone = p_phone, whatsapp = p_whatsapp where id = auth.uid();
$$;

create policy audit_read on public.audit_log
  for select to authenticated
  using (public.is_engineer_or_above() or changed_by = auth.uid());

-- No insert/update/delete policies on audit_log: only the security definer
-- trigger writes to it.

revoke all on public.audit_log from anon;
revoke all on public.profiles from anon;
