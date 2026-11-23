-- REVIEW PROPOSAL ONLY. Do not run in Production without Micha/Ümit's agreement.
-- Install after the reviewed profile trigger AND server-session migration.
-- Kept outside migrations/ to prevent accidental automatic installation.
begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.inventory_session_is_active()') is null
    or pg_catalog.to_regclass('inventory_private.sessions') is null
    or pg_catalog.to_regprocedure('public.inventory_create_employee_profile()') is null then
    raise exception 'Install the reviewed profile and server-session migrations first';
  end if;
  if exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'disabled_at') then
    raise exception 'disabled_at already exists: review existing schema before continuing';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'inventory_auth_user_employee_profile'
      and tgenabled = 'O' and not tgisinternal) then
    raise exception 'The reviewed profile trigger must be enabled';
  end if;
end $$;

alter table public.profiles add column disabled_at timestamptz;

-- All profile writes go through reviewed administrative functions.
-- Coordinate these grants with future self-service/RBAC features.
revoke insert, update, delete on public.profiles from anon, authenticated;

create function public.inventory_user_is_enabled()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = (select auth.uid()) and p.disabled_at is null
      and (u.banned_until is null or u.banned_until <= pg_catalog.now())
  );
$$;
revoke all on function public.inventory_user_is_enabled() from public, anon, authenticated, service_role;
grant execute on function public.inventory_user_is_enabled() to anon, authenticated;

-- Restrictive policies do not grant any extra SELECT/INSERT/UPDATE permission.
-- Disabled accounts cannot use still-valid JWTs on any of the six application tables.
do $$
declare table_name text;
begin
  foreach table_name in array array['profiles', 'roles', 'devices', 'assignments', 'device_status_history', 'audit_logs'] loop
    if not exists (select 1 from pg_catalog.pg_class
      where oid = pg_catalog.to_regclass('public.' || table_name) and relrowsecurity) then
      raise exception 'All application tables must already have RLS enabled';
    end if;
    execute pg_catalog.format(
      'create policy inventory_enabled_user_guard on public.%I as restrictive for all to anon, authenticated using ((select public.inventory_user_is_enabled())) with check ((select public.inventory_user_is_enabled()))', table_name);
  end loop;
end $$;

create function inventory_private.require_user_admin()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  -- Derive the current role from the DB, never user_metadata or client parameters.
  perform 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = caller and p.disabled_at is null and r.name = 'admin'
    for share of p, r;
  if not found or not public.inventory_user_is_enabled()
    or not public.inventory_session_is_active() then
    raise exception using errcode = '42501', message = 'Administrator with active session required';
  end if;
  return caller;
end $$;
revoke all on function inventory_private.require_user_admin() from public, anon, authenticated, service_role;

create function public.inventory_admin_check()
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform inventory_private.require_user_admin();
  return true;
end $$;

create function public.inventory_admin_creation_ready()
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform inventory_private.require_user_admin();
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'inventory_auth_user_employee_profile'
      and tgfoid = 'public.inventory_create_employee_profile()'::regprocedure
      and tgenabled = 'O' and not tgisinternal)
    or (select count(*) from public.roles where name = 'employee') <> 1 then
    raise exception using errcode = '55000', message = 'Atomic profile creation is not ready';
  end if;
  return true;
end $$;

create function public.inventory_admin_list_users(page_number integer, search_text text)
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
    where strpos(lower(concat_ws(' ', p.first_name, p.last_name, u.email, r.name)), lower(trim(search_text))) > 0
      or trim(search_text) = ''
  ), page as (
    select * from matching order by last_name nulls last, first_name nulls last, id
    limit 25 offset (page_number * 25)
  )
  select jsonb_build_object('users', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb),
    'total', (select count(*) from matching)) into result;
  return result;
end $$;

create function public.inventory_admin_update_user(target_id uuid, given_name text, family_name text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform inventory_private.require_user_admin();
  if given_name is null or family_name is null
    or length(trim(given_name)) not between 1 and 100
    or length(trim(family_name)) not between 1 and 100
    or given_name ~ '[[:cntrl:]]' or family_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Invalid name';
  end if;
  update public.profiles set first_name = trim(given_name), last_name = trim(family_name), updated_at = pg_catalog.now()
    where id = target_id;
  if not found then raise exception using errcode = 'P0002', message = 'User not found'; end if;
end $$;

create function public.inventory_admin_disable_user(target_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare caller uuid;
begin
  caller := inventory_private.require_user_admin();
  if target_id = caller then
    raise exception using errcode = '22023', message = 'Self-deactivation is not allowed';
  end if;
  update public.profiles set disabled_at = coalesce(disabled_at, pg_catalog.now()), updated_at = pg_catalog.now()
    where id = target_id;
  if not found then raise exception using errcode = 'P0002', message = 'User not found'; end if;
  update inventory_private.sessions set revoked_at = coalesce(revoked_at, pg_catalog.now()) where user_id = target_id;
end $$;

revoke all on function public.inventory_admin_check(), public.inventory_admin_creation_ready(),
  public.inventory_admin_list_users(integer, text), public.inventory_admin_update_user(uuid, text, text),
  public.inventory_admin_disable_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.inventory_admin_check(), public.inventory_admin_creation_ready(),
  public.inventory_admin_list_users(integer, text), public.inventory_admin_update_user(uuid, text, text),
  public.inventory_admin_disable_user(uuid) to authenticated;
commit;
