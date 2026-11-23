-- Am 26.10.2026 manuell installiert. Vor erneutem Ausführen den Datenbankstand prüfen.
-- Erlaubt nur das Lesen des eigenen Profils und der zugehörigen Rolle.
begin;

lock table public.profiles, public.roles in share row exclusive mode;

do $preflight$
declare
  target_table regclass;
begin
  if pg_catalog.to_regprocedure('auth.uid()') is null then
    raise exception using
      errcode = '55000',
      message = 'Device Inventory: auth.uid() muss vor der Installation existieren.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'authenticated' and not rolsuper and not rolbypassrls
  ) then
    raise exception using
      errcode = '55000',
      message = 'Device Inventory: authenticated muss eine normale, RLS-gebundene Datenbankrolle sein.';
  end if;

  foreach target_table in array array['public.profiles'::regclass, 'public.roles'::regclass] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      where c.oid = target_table and c.relrowsecurity and c.relkind in ('r', 'p')
    ) then
      raise exception using
        errcode = '55000',
        message = 'Device Inventory: RLS muss für profiles und roles bereits aktiviert sein.',
        hint = 'Den Tabellenzustand mit dem Team prüfen; diese Migration aktiviert oder ersetzt keine RLS-Konfiguration.';
    end if;

    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = target_table) then
      raise exception using
        errcode = '55000',
        message = 'Device Inventory: vorhandene Profil-/Rollen-Policies müssen zuerst manuell abgestimmt werden.',
        hint = 'Keine Policies überschreiben oder blind kombinieren. Auch eine erneute Ausführung wird bewusst abgebrochen.';
    end if;

    if exists (
      select 1 from pg_catalog.pg_class c
      where c.oid = target_table
        and pg_catalog.pg_has_role('authenticated', c.relowner, 'USAGE')
    ) then
      raise exception using
        errcode = '55000',
        message = 'Device Inventory: authenticated darf keine Eigentümerrechte an profiles oder roles besitzen.';
    end if;

    if not pg_catalog.has_table_privilege('authenticated', target_table, 'SELECT') then
      raise exception using
        errcode = '55000',
        message = 'Device Inventory: authenticated benötigt bereits abgestimmte SELECT-Tabellenrechte.',
        hint = 'Diese Migration vergibt keine pauschalen Tabellenrechte.';
    end if;
  end loop;
end;
$preflight$;

create policy inventory_profile_read_self
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy inventory_role_read_self
on public.roles
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role_id = roles.id
  )
);

commit;
