-- Testgrundlage: Nachbildung des Supabase-Schemas für lokale Tests.
--
-- Die Tabellen entsprechen den in Issue #21 dokumentierten Spalten der
-- Supabase-Datenbank. Datentypen und Constraints folgen docs/sql-tables.md und
-- dem Project Log vom 16.10.2026. Sobald ein Export des echten Schemas
-- (`supabase db dump`) im Repository liegt, sollte er diese Datei ersetzen.

-- Von Supabase bereitgestellte Rollen und Auth-Funktionen
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- Tabellen des Device Inventory
create table public.roles (
  id bigint generated always as identity primary key,
  name text not null unique,
  description text
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role_id bigint references public.roles (id),
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  asset_tag text not null unique,
  serial_number text,
  device_type text,
  manufacture text,
  model text,
  status text not null default 'available'
    check (status in ('available', 'assigned', 'defective', 'maintenance', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id),
  employee_id uuid not null references public.profiles (id),
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (returned_at is null or returned_at >= assigned_at)
);

create unique index assignments_one_active_per_device
  on public.assignments (device_id)
  where returned_at is null;

create table public.device_status_history (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id),
  old_status text
    check (old_status in ('available', 'assigned', 'defective', 'maintenance', 'retired')),
  new_status text not null
    check (new_status in ('available', 'assigned', 'defective', 'maintenance', 'retired')),
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text,
  entity_type text,
  entity_title text,
  details jsonb,
  created_at timestamptz default now()
);

-- Standardrechte, wie Supabase sie für das Schema public vergibt
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;

insert into public.roles (name, description) values
  ('admin', 'Administrator'),
  ('device_manager', 'Gerätemanager'),
  ('employee', 'Mitarbeiter');
