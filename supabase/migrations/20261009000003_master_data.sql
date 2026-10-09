-- Master data: assets and aliases, parameter dictionary, registers (digital
-- versions of the paper log sheets), loggers, duty roster and app settings.

-- ---------------------------------------------------------------------------
-- App settings (configurable thresholds)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (key, value, description) values
  ('reading_late_after_min', '30', 'A reading becomes "late" this many minutes after its slot time.'),
  ('reading_missing_after_min', '120', 'A reading becomes "missing" this many minutes after its slot time.'),
  ('rca_hours_at_or_above', '4', 'Downtime of this many hours or more requires an RCA.'),
  ('rca_repeats_at_or_above', '3', 'This many repeats of the same failure on the same equipment requires an RCA.'),
  ('escalate_engineer_after_min', '15', 'Overdue items go to the on-duty engineer after this many minutes.'),
  ('escalate_manager_after_min', '45', 'Overdue items go to the shift manager after this many minutes.'),
  ('checkin_alert_after_min', '30', 'Alert the section manager if nobody has checked in this many minutes after shift start.'),
  ('digest_hour', '7', 'Hour (Lagos) when the daily compliance digest is sent.'),
  ('bootstrap_admin_emails', '["samtonmajek13@gmail.com","samuel.majekodunmi@chilimited.com"]',
     'Accounts with these emails become active admins when first created.');

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------
create table public.asset_categories (
  id    smallint generated always as identity primary key,
  name  text not null unique,
  sort  smallint not null default 0
);

create type public.asset_status as enum ('active', 'standby', 'retired');

create table public.assets (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  category_id     smallint not null references public.asset_categories (id),
  area            public.area_code,
  make            text,
  model           text,
  capacity        text,
  rated_output    numeric,
  rated_unit      text,
  criticality     text check (criticality in ('A', 'B', 'C')),
  status          public.asset_status not null default 'active',
  confirmed       boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.assets.confirmed is
  'False until the section manager confirms the asset exists as described (code, name, area).';

create index assets_category_idx on public.assets (category_id);

create table public.asset_aliases (
  id         uuid primary key default gen_random_uuid(),
  asset_id   uuid not null references public.assets (id),
  alias      text not null,
  source     text not null,
  confirmed  boolean not null default false,
  note       text,
  created_at timestamptz not null default now(),
  unique (source, alias)
);

comment on table public.asset_aliases is
  'How each source file names an asset (e.g. PM register "STEAM BOILER 1" → BLR-01). Unconfirmed aliases appear on the admin review list.';

-- ---------------------------------------------------------------------------
-- Parameter dictionary
-- ---------------------------------------------------------------------------
create type public.param_type as enum ('number', 'select', 'text');

create table public.parameters (
  id                  uuid primary key default gen_random_uuid(),
  equipment_group     text not null,
  name                text not null,
  unit                text,
  data_type           public.param_type not null default 'number',
  options             text[],
  ok_options          text[],
  std_min             numeric,
  std_max             numeric,
  crit_min            numeric,
  crit_max            numeric,
  standard_as_written text,
  standard_source     text,
  alt_standard        text,
  needs_review        boolean not null default false,
  review_note         text,
  is_counter          boolean not null default false,
  sort                integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (equipment_group, name),
  check (data_type <> 'select' or options is not null),
  check (std_min is null or std_max is null or std_min <= std_max),
  check (crit_min is null or crit_max is null or crit_min <= crit_max)
);

comment on column public.parameters.ok_options is 'For select parameters: the answers that count as in spec (e.g. "No Leak").';
comment on column public.parameters.alt_standard is 'A conflicting standard found elsewhere in the source files, kept for the owner to decide.';
comment on column public.parameters.is_counter is 'Cumulative counters (running hours, totalisers): never out of spec, used for operating hours and consumption.';

-- ---------------------------------------------------------------------------
-- Registers (digital log sheets)
-- ---------------------------------------------------------------------------
-- A register is one paper form (e.g. U1 Boiler Log, CHIENGUTRG03). It has
-- sections; each section has a reading frequency (its slots) and fields.
-- A field is a parameter, optionally pinned to one asset. Unpinned fields
-- repeat for every asset attached to the register (e.g. Boilers 1, 2 and 5).

create type public.slot_kind as enum ('time', 'shift', 'daily_high_low', 'daily');

create table public.registers (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  area          public.area_code not null,
  document_no   text not null,
  title         text not null,
  source_sheet  text,
  description   text,
  active        boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.register_assets (
  register_id uuid not null references public.registers (id),
  asset_id    uuid not null references public.assets (id),
  sort        integer not null default 0,
  primary key (register_id, asset_id)
);

create table public.register_sections (
  id           uuid primary key default gen_random_uuid(),
  register_id  uuid not null references public.registers (id),
  title        text not null,
  slot_kind    public.slot_kind not null,
  slot_times   time[],
  sort         integer not null default 0,
  check (slot_kind <> 'time' or (slot_times is not null and cardinality(slot_times) > 0))
);

create table public.register_fields (
  id           uuid primary key default gen_random_uuid(),
  section_id   uuid not null references public.register_sections (id),
  parameter_id uuid not null references public.parameters (id),
  asset_id     uuid references public.assets (id),
  label        text not null,
  sort         integer not null default 0,
  active       boolean not null default true
);

create index register_fields_section_idx on public.register_fields (section_id, sort);

-- ---------------------------------------------------------------------------
-- Loggers (devices that submit readings) and duty roster
-- ---------------------------------------------------------------------------
create table public.loggers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  api_key_hash text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.duty_roster (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id),
  shift_date  date not null,
  shift       text not null check (shift in ('day', 'night')),
  areas       public.area_code[] not null default '{U1,U2}',
  duty_role   text not null default 'engineer' check (duty_role in ('operator', 'engineer', 'shift_manager')),
  created_at  timestamptz not null default now(),
  unique (profile_id, shift_date, shift)
);

create index duty_roster_date_idx on public.duty_roster (shift_date, shift);

-- ---------------------------------------------------------------------------
-- Timestamps, audit and RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['assets', 'parameters', 'registers'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['assets', 'asset_aliases', 'parameters', 'registers', 'register_sections',
                           'register_fields', 'loggers', 'duty_roster'] loop
    perform public.enable_audit(format('public.%I', t)::regclass, false);
  end loop;
end $$;

-- register_assets has a composite key; audit it separately without the id column.
create or replace function public.audit_register_assets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  values ('register_assets',
          coalesce(new.register_id, old.register_id)::text || ':' || coalesce(new.asset_id, old.asset_id)::text,
          case tg_op when 'INSERT' then 'insert' else 'void' end,
          auth.uid(),
          case when tg_op = 'DELETE' then to_jsonb(old) end,
          case when tg_op = 'INSERT' then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.audit_register_assets() from public, anon, authenticated;
create trigger audit_register_assets after insert or delete on public.register_assets
  for each row execute function public.audit_register_assets();

do $$
declare t text;
begin
  foreach t in array array['app_settings', 'asset_categories', 'assets', 'asset_aliases', 'parameters',
                           'registers', 'register_assets', 'register_sections', 'register_fields',
                           'loggers', 'duty_roster'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_role(''admin'', ''section_manager'')) with check (public.has_role(''admin'', ''section_manager''))',
      t || '_admin_write', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- loggers.api_key_hash must never leave the database.
revoke select on public.loggers from authenticated;
grant select (id, name, description, active, created_at) on public.loggers to authenticated;

-- Shift managers also maintain the duty roster.
create policy duty_roster_shift_manager_write on public.duty_roster
  for all to authenticated
  using (public.has_role('shift_manager'))
  with check (public.has_role('shift_manager'));

-- ---------------------------------------------------------------------------
-- New users: bootstrap admins are active admins, everyone else waits for an
-- admin to activate them and set their role. Role/active may be preset in
-- app_metadata, which only the server (service role) can write, never in
-- user_metadata, which the person signing up controls.
-- ---------------------------------------------------------------------------
alter table public.profiles alter column active set default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_bootstrap boolean;
begin
  select coalesce(lower(new.email) in (select lower(jsonb_array_elements_text(value)) from public.app_settings
                                       where key = 'bootstrap_admin_emails'), false)
    into is_bootstrap;

  insert into public.profiles (id, full_name, email, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    case when is_bootstrap then 'admin'::public.app_role
         else coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'viewer')::public.app_role end,
    is_bootstrap or coalesce((new.raw_app_meta_data ->> 'active')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
