-- Noch nicht installiert. Vorher mit der Benutzerverwaltung abstimmen.
-- Neue Auth-Konten erhalten ein employee-Profil.
begin;

-- Während der Installation dürfen keine neuen Auth-Konten entstehen.
lock table auth.users in share row exclusive mode;

do $preflight$
declare
  existing_triggers text;
begin
  if pg_catalog.to_regclass('public.profiles') is null
    or pg_catalog.to_regclass('public.roles') is null then
    raise exception using
      errcode = '55000',
      message = 'Device Inventory: public.profiles und public.roles müssen bereits existieren.',
      hint = 'Zuerst das abgestimmte Team-Schema prüfen; diese Migration erstellt keine Basistabellen.';
  end if;

  -- Auch deaktivierte und indirekt Profile anlegende INSERT-Trigger prüfen.
  select pg_catalog.string_agg(t.tgname::text, ', ' order by t.tgname)
    into existing_triggers
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'auth.users'::pg_catalog.regclass
    and not t.tgisinternal
    and (t.tgtype::integer & 4) <> 0;

  if existing_triggers is not null then
    raise exception using
      errcode = '55000',
      message = 'Device Inventory: vorhandene Auth-INSERT-Trigger müssen zuerst manuell geprüft werden.',
      detail = existing_triggers,
      hint = 'Keine Trigger blind löschen oder doppelt installieren. Auch eine erneute Ausführung dieser Migration wird bewusst abgebrochen.';
  end if;

  if pg_catalog.to_regprocedure('public.inventory_create_employee_profile()') is not null then
    raise exception using
      errcode = '55000',
      message = 'Device Inventory: die vorgesehene Triggerfunktion existiert bereits.',
      hint = 'Definition und Migrationshistorie prüfen; vorhandene Funktionen werden nicht überschrieben.';
  end if;

  if (select pg_catalog.count(*) from public.roles r where r.name = 'employee') <> 1 then
    raise exception using
      errcode = '55000',
      message = 'Device Inventory: genau eine Rolle mit dem Namen employee ist erforderlich.',
      hint = 'Fehlende oder doppelte Rollen mit dem Team klären; keine vorhandenen Rollenzuweisungen automatisch ändern.';
  end if;

  -- Rollennamen müssen durch einen UNIQUE-Constraint oder Index eindeutig sein.
  if not exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a
      on a.attrelid = i.indrelid and a.attname = 'name' and not a.attisdropped
    where i.indrelid = 'public.roles'::pg_catalog.regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
      and i.indpred is null and i.indexprs is null
      and i.indnkeyatts = 1 and i.indkey[0] = a.attnum
  ) then
    raise exception using
      errcode = '55000',
      message = 'Device Inventory: roles.name benötigt eine eindeutige, sofort wirksame Datenbankgarantie.',
      hint = 'UNIQUE-Constraint/Index und mögliche Duplikate vorab mit dem Team prüfen; die Migration verändert keine Rollenstruktur.';
  end if;
end;
$preflight$;

create function public.inventory_create_employee_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  employee_role_id public.roles.id%type;
  profile_first_name text;
  profile_last_name text;
begin
  if tg_table_schema <> 'auth' or tg_table_name <> 'users'
    or tg_op <> 'INSERT' or tg_when <> 'AFTER' or tg_level <> 'ROW' then
    raise exception using
      errcode = '55000',
      message = 'Device Inventory: unzulässiger Aufruf des Auth-Profil-Triggers.';
  end if;

  -- Die Rolle bei jeder Anlage prüfen und bis zum Commit sperren.
  select r.id into strict employee_role_id
  from public.roles r
  where r.name = 'employee'
  for key share;

  -- Nur gültige Namen übernehmen. Die Rolle kommt nie aus Benutzermetadaten.
  if pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'first_name') = 'string' then
    profile_first_name := pg_catalog.btrim(new.raw_user_meta_data ->> 'first_name');
    if pg_catalog.char_length(profile_first_name) not between 1 and 100 then
      profile_first_name := null;
    end if;
  end if;
  if pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'last_name') = 'string' then
    profile_last_name := pg_catalog.btrim(new.raw_user_meta_data ->> 'last_name');
    if pg_catalog.char_length(profile_last_name) not between 1 and 100 then
      profile_last_name := null;
    end if;
  end if;

  -- Bei einem Fehler werden Profil und Auth-Konto gemeinsam zurückgerollt.
  insert into public.profiles (id, role_id, first_name, last_name)
  values (new.id, employee_role_id, profile_first_name, profile_last_name);

  return new;
end;
$function$;

-- Die Triggerfunktion darf nicht direkt vom Client aufgerufen werden.
revoke all on function public.inventory_create_employee_profile()
  from public, anon, authenticated, service_role;

create trigger inventory_auth_user_employee_profile
after insert on auth.users
for each row execute function public.inventory_create_employee_profile();

commit;
