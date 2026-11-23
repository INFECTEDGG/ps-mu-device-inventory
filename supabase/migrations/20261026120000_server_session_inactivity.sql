-- Noch nicht installiert. SQL und Vercel-Frontend gemeinsam im Team freigeben.
-- Danach VITE_SERVER_SESSION_GUARD=true setzen und das Frontend neu bauen.
begin;
set local lock_timeout = '5s';

lock table public.profiles, public.roles, public.devices, public.assignments,
  public.device_status_history, public.audit_logs in share row exclusive mode;

do $preflight$
declare
  target_name text;
  target_table regclass;
begin
  if pg_catalog.to_regnamespace('inventory_private') is not null then
    raise exception using errcode = '55000',
      message = 'Device Inventory: inventory_private existiert bereits; Installation zuerst abstimmen.';
  end if;
  if pg_catalog.to_regprocedure('auth.uid()') is null
    or pg_catalog.to_regprocedure('auth.jwt()') is null
    or pg_catalog.to_regclass('auth.sessions') is null then
    raise exception using errcode = '55000',
      message = 'Device Inventory: Supabase Auth mit uid(), jwt() und auth.sessions wird benötigt.';
  end if;
  if not pg_catalog.has_table_privilege(current_user, 'auth.sessions', 'SELECT')
    or not pg_catalog.has_table_privilege(current_user, 'auth.sessions', 'UPDATE') then
    raise exception using errcode = '55000',
      message = 'Device Inventory: der Funktionsbesitzer muss Auth-Sitzungen lesen und für Lebenszyklusaktionen sperren dürfen.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'inventory_session_start', 'inventory_session_status',
      'inventory_session_touch', 'inventory_session_end', 'inventory_session_is_active'
    )
  ) then
    raise exception using errcode = '55000',
      message = 'Device Inventory: vorhandene Sitzungsfunktionen werden nicht überschrieben.';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_roles
      where rolname in ('anon', 'authenticated') and not rolsuper and not rolbypassrls) <> 2 then
    raise exception using errcode = '55000',
      message = 'Device Inventory: Clientrollen müssen RLS-gebunden sein.';
  end if;

  foreach target_name in array array[
    'profiles', 'roles', 'devices', 'assignments', 'device_status_history', 'audit_logs'
  ] loop
    target_table := pg_catalog.to_regclass('public.' || target_name);
    if target_table is null or not exists (
      select 1 from pg_catalog.pg_class c
      where c.oid = target_table and c.relrowsecurity and c.relkind in ('r', 'p')
    ) then
      raise exception using errcode = '55000',
        message = 'Device Inventory: alle sechs Anwendungstabellen müssen bereits RLS verwenden.';
    end if;
    if exists (
      select 1 from pg_catalog.pg_class c
      where c.oid = target_table and (
        pg_catalog.pg_has_role('authenticated', c.relowner, 'USAGE')
        or pg_catalog.pg_has_role('anon', c.relowner, 'USAGE')
      )
    ) then
      raise exception using errcode = '55000',
        message = 'Device Inventory: Clientrollen dürfen keine Tabelleneigentümerrechte besitzen.';
    end if;
    if exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = target_table and p.polname = 'inventory_active_session_guard'
    ) then
      raise exception using errcode = '55000',
        message = 'Device Inventory: die Sitzungs-Policy existiert bereits; Migrationshistorie prüfen.';
    end if;
  end loop;
end;
$preflight$;

create schema inventory_private;
revoke all on schema inventory_private from public, anon, authenticated, service_role;

create table inventory_private.sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_active_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table inventory_private.sessions enable row level security;
revoke all on table inventory_private.sessions from public, anon, authenticated, service_role;

-- Benutzer und Sitzung werden aus dem signierten JWT gelesen.
create function inventory_private.jwt_identity()
returns table(user_id uuid, session_id uuid)
language plpgsql security definer set search_path = ''
as $function$
declare claims jsonb; caller uuid; sid uuid;
begin
  claims := auth.jwt();
  if claims ->> 'role' is distinct from 'authenticated' then return; end if;
  begin
    caller := auth.uid();
    sid := (claims ->> 'session_id')::uuid;
  exception when invalid_text_representation then return;
  end;
  if caller is null or sid is null then return; end if;
  return query select caller, sid;
end;
$function$;

-- Immer zuerst die Auth-Zeile sperren, danach den eigenen Sitzungsdatensatz.
-- So bleiben gleichzeitige Start- und Abmeldeanfragen in derselben Reihenfolge.
create function inventory_private.auth_context(lock_auth boolean)
returns table(user_id uuid, session_id uuid, auth_created_at timestamptz, auth_not_after timestamptz)
language plpgsql security definer set search_path = ''
as $function$
declare identity_row record;
begin
  select * into identity_row from inventory_private.jwt_identity();
  if not found then return; end if;
  if lock_auth then
    return query select s.user_id, s.id, s.created_at, s.not_after
    from auth.sessions s
    where s.id = identity_row.session_id and s.user_id = identity_row.user_id
    for update of s;
  else
    return query select s.user_id, s.id, s.created_at, s.not_after
    from auth.sessions s
    where s.id = identity_row.session_id and s.user_id = identity_row.user_id;
  end if;
end;
$function$;

create function inventory_private.response(caller uuid, sid uuid, server_time timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  stored inventory_private.sessions%rowtype;
  result_reason text := 'invalid';
  expires_ms bigint := null;
  auth_deadline timestamptz;
  server_ms bigint := pg_catalog.floor(extract(epoch from server_time) * 1000)::bigint;
begin
  if caller is not null and sid is not null then
    select s.not_after into auth_deadline from auth.sessions s
    where s.id = sid and s.user_id = caller;
    if not found or (auth_deadline is not null and auth_deadline <= server_time) then
      return pg_catalog.jsonb_build_object(
        'active', false, 'sessionId', sid, 'userId', caller,
        'expiresAt', null, 'serverNow', server_ms, 'reason', 'invalid'
      );
    end if;
    select * into stored from inventory_private.sessions a
    where a.session_id = sid and a.user_id = caller;
    if not found then
      result_reason := 'missing';
    else
      expires_ms := pg_catalog.floor(extract(epoch from least(
        stored.last_active_at + interval '30 minutes',
        coalesce(auth_deadline, stored.last_active_at + interval '30 minutes')
      )) * 1000)::bigint;
      if stored.revoked_at is not null then result_reason := 'revoked';
      elsif stored.last_active_at > server_time then result_reason := 'invalid';
      elsif server_time >= stored.last_active_at + interval '30 minutes'
        or expires_ms <= server_ms then result_reason := 'expired';
      else result_reason := 'active';
      end if;
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'active', result_reason = 'active', 'sessionId', sid, 'userId', caller,
    'expiresAt', expires_ms, 'serverNow', server_ms, 'reason', result_reason
  );
end;
$function$;

create function inventory_private.status_for_request()
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare identity_row record;
begin
  select * into identity_row from inventory_private.jwt_identity();
  if not found then
    return inventory_private.response(null, null, pg_catalog.clock_timestamp());
  end if;
  return inventory_private.response(identity_row.user_id, identity_row.session_id, pg_catalog.clock_timestamp());
end;
$function$;

create function public.inventory_session_start()
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare context_row record; stored inventory_private.sessions%rowtype; server_time timestamptz;
begin
  select * into context_row from inventory_private.auth_context(true);
  if not found then return inventory_private.status_for_request(); end if;
  select * into stored from inventory_private.sessions a
  where a.session_id = context_row.session_id for update;
  server_time := pg_catalog.clock_timestamp();
  if not found and context_row.auth_created_at <= server_time
    and (context_row.auth_not_after is null or context_row.auth_not_after > server_time)
    and context_row.auth_created_at >= server_time - interval '60 seconds' then
    insert into inventory_private.sessions(session_id, user_id, last_active_at)
    values(context_row.session_id, context_row.user_id, server_time)
    on conflict (session_id) do nothing;
  end if;
  -- Ein erneuter Start verlängert oder reaktiviert keine bestehende Sitzung.
  return inventory_private.response(context_row.user_id, context_row.session_id, pg_catalog.clock_timestamp());
end;
$function$;

create function public.inventory_session_status()
returns jsonb
language sql security definer set search_path = ''
as $function$
  select inventory_private.status_for_request();
$function$;

create function public.inventory_session_touch()
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare context_row record; stored inventory_private.sessions%rowtype; server_time timestamptz;
begin
  select * into context_row from inventory_private.auth_context(true);
  if not found then return inventory_private.status_for_request(); end if;
  select * into stored from inventory_private.sessions a
  where a.session_id = context_row.session_id for update;
  server_time := pg_catalog.clock_timestamp();
  -- Dieselbe Ablaufgrenze wie bei Status und RLS verwenden.
  if found and coalesce((inventory_private.response(
    context_row.user_id, context_row.session_id, server_time
  ) ->> 'active')::boolean, false) then
    update inventory_private.sessions a set last_active_at = server_time
    where a.session_id = context_row.session_id and a.user_id = context_row.user_id;
  end if;
  return inventory_private.response(context_row.user_id, context_row.session_id, pg_catalog.clock_timestamp());
end;
$function$;

create function public.inventory_session_end()
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare context_row record; identity_row record; server_time timestamptz;
begin
  select * into context_row from inventory_private.auth_context(true);
  if not found then
    select * into identity_row from inventory_private.jwt_identity();
    if found then
      -- Auch nach dem Auth-Logout einen vorhandenen eigenen Datensatz widerrufen.
      update inventory_private.sessions a
      set revoked_at = coalesce(a.revoked_at, pg_catalog.clock_timestamp())
      where a.session_id = identity_row.session_id and a.user_id = identity_row.user_id;
    end if;
    return inventory_private.status_for_request();
  end if;
  perform 1 from inventory_private.sessions a
  where a.session_id = context_row.session_id for update;
  server_time := pg_catalog.clock_timestamp();
  insert into inventory_private.sessions(session_id, user_id, last_active_at, revoked_at)
  values(context_row.session_id, context_row.user_id, server_time, server_time)
  on conflict (session_id) do update
    set revoked_at = coalesce(inventory_private.sessions.revoked_at, excluded.revoked_at)
    where inventory_private.sessions.user_id = excluded.user_id;
  return inventory_private.response(context_row.user_id, context_row.session_id, pg_catalog.clock_timestamp());
end;
$function$;

create function public.inventory_session_is_active()
returns boolean
language sql security definer set search_path = ''
as $function$
  select coalesce((inventory_private.status_for_request() ->> 'active')::boolean, false);
$function$;

revoke all on all functions in schema inventory_private from public, anon, authenticated, service_role;
revoke all on function public.inventory_session_start(), public.inventory_session_status(),
  public.inventory_session_touch(), public.inventory_session_end(), public.inventory_session_is_active()
  from public, anon, authenticated, service_role;
grant execute on function public.inventory_session_start(), public.inventory_session_status(),
  public.inventory_session_touch(), public.inventory_session_end() to authenticated;
grant execute on function public.inventory_session_is_active() to anon, authenticated;

do $policies$
declare target_name text;
begin
  foreach target_name in array array[
    'profiles', 'roles', 'devices', 'assignments', 'device_status_history', 'audit_logs'
  ] loop
    execute pg_catalog.format(
      'create policy inventory_active_session_guard on public.%I as restrictive for all to anon, authenticated using ((select public.inventory_session_is_active())) with check ((select public.inventory_session_is_active()))',
      target_name
    );
  end loop;
end;
$policies$;

commit;
