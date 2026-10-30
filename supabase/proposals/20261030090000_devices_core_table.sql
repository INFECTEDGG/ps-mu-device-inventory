-- PBI-06: Stammdaten-Tabelle fuer den zentralen Geraetebestand.
-- Ein neu angelegtes Geraet ist mit dem Insert sofort Teil des Bestands;
-- sichtbar wird es ueber die Select-Policy weiter unten.
-- Voraussetzung: public.profiles und public.roles existieren bereits.
-- REVIEW PROPOSAL ONLY. Vor Produktionseinsatz im Team abstimmen.
begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null
    or pg_catalog.to_regclass('public.roles') is null then
    raise exception 'public.profiles und public.roles muessen bereits existieren';
  end if;
  if pg_catalog.to_regclass('public.devices') is not null then
    raise exception 'public.devices existiert bereits: vorhandenes Schema zuerst pruefen';
  end if;
end $$;

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  asset_tag text not null,
  serial_number text not null,
  device_type text not null,
  manufacturer text not null,
  model text not null,
  status text not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_asset_tag_unique unique (asset_tag),
  constraint devices_serial_number_unique unique (serial_number),
  constraint devices_asset_tag_not_blank check (btrim(asset_tag) <> ''),
  constraint devices_serial_number_not_blank check (btrim(serial_number) <> ''),
  constraint devices_device_type_not_blank check (btrim(device_type) <> ''),
  constraint devices_manufacturer_not_blank check (btrim(manufacturer) <> ''),
  constraint devices_model_not_blank check (btrim(model) <> ''),
  constraint devices_status_valid check (
    status in ('available', 'assigned', 'defective', 'maintenance', 'retired')
  )
);

alter table public.devices enable row level security;

-- devices:view_all / devices:manage: nur device_manager, admin und super_admin
-- sehen den vollen Bestand. "Nur eigene zugewiesene Geraete" (employee,
-- devices:view_own) kommt erst mit der assignments-Tabelle aus PBI-10.
create policy devices_select_managed on public.devices
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p join public.roles r on r.id = p.role_id
      where p.id = auth.uid() and r.name in ('device_manager', 'admin', 'super_admin')
    )
  );

create policy devices_insert_managed on public.devices
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p join public.roles r on r.id = p.role_id
      where p.id = auth.uid() and r.name in ('device_manager', 'admin', 'super_admin')
    )
  );

create function public.inventory_set_devices_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.inventory_set_devices_updated_at();

commit;
