-- Folgemigration: vollstaendig deaktivierte Konten standardmaessig aus der Benutzerliste ausblenden.
-- Datensaetze bleiben erhalten (Audit/Zuordnungen); keine Loeschung.
-- Nicht vollstaendig gesperrte Konten bleiben sichtbar, damit die Auth-Sperre erneut
-- ausgefuehrt werden kann ("Anmeldesperre ausstehend").
-- Nach Installation von 20261027090000_user_management.sql und
-- 20261028102000_superadmin_role_permissions.sql anwenden.
begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.inventory_admin_list_users(integer,text)') is null
    or pg_catalog.to_regprocedure('inventory_private.require_user_admin()') is null
    or not exists (select 1 from public.roles where name='super_admin') then
    raise exception 'Benutzerverwaltung und SuperAdmin-Migration zuerst installieren';
  end if;
end $$;

create or replace function public.inventory_admin_list_users(page_number integer, search_text text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare result jsonb;
begin
  perform inventory_private.require_user_admin();
  if page_number is null or page_number < 0 or page_number > 100000
    or search_text is null or length(search_text) > 100 then
    raise exception using errcode = '22023', message = 'Invalid pagination';
  end if;
  with matching as (
    select p.id, p.first_name, p.last_name, u.email, r.name as role, p.disabled_at,
      coalesce(u.banned_until > pg_catalog.now(), false) as login_blocked
    from public.profiles p
    join auth.users u on u.id = p.id join public.roles r on r.id = p.role_id
    -- Abgeschlossene Deaktivierungen ausblenden; offene Auth-Sperren bleiben sichtbar,
    -- damit die Aktion "Sperre abschließen" weiterhin möglich ist.
    where (p.disabled_at is null or not coalesce(u.banned_until > pg_catalog.now(), false))
      and (
        strpos(lower(concat_ws(' ', p.first_name, p.last_name, u.email, r.name)), lower(trim(search_text))) > 0
        or trim(search_text) = ''
      )
  ), page as (
    select * from matching order by last_name nulls last, first_name nulls last, id
    limit 25 offset (page_number * 25)
  )
  select jsonb_build_object('users', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb),
    'total', (select count(*) from matching)) into result;
  return result;
end $$;

commit;
