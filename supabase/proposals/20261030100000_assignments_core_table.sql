-- PBI-10: Zuweisung eines Geraets an einen Mitarbeiter.
-- returned_at/returned_by sind fuer die spaetere Ruecknahme (PBI-11) vorgesehen,
-- werden hier aber noch nicht befuellt.
-- Voraussetzung: public.devices und public.profiles existieren bereits.
-- REVIEW PROPOSAL ONLY. Vor Produktionseinsatz im Team abstimmen.
begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.devices') is null
    or pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'public.devices und public.profiles muessen bereits existieren';
  end if;
  if pg_catalog.to_regclass('public.assignments') is not null then
    raise exception 'public.assignments existiert bereits: vorhandenes Schema zuerst pruefen';
  end if;
end $$;

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  employee_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Ein Geraet darf gleichzeitig nur eine aktive (nicht zurueckgegebene) Zuweisung haben.
create unique index assignments_one_active_per_device
  on public.assignments (device_id)
  where returned_at is null;

commit;
