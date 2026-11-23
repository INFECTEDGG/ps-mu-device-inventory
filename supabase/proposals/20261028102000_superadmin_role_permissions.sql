-- REVIEW / DEPLOY MANUALLY after 20261027090000_user_management.sql.
-- Production change. Backup and check active sessions first. Never run automatically.
-- NO account is elevated by this script. Use the separate manual bootstrap procedure.
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.inventory_admin_check()') is null
    or to_regprocedure('public.inventory_session_is_active()') is null
    or to_regclass('inventory_private.sessions') is null
    or to_regprocedure('public.inventory_admin_disable_user(uuid)') is null then
    raise exception 'Install user-management and server-session migrations before RBAC extension';
  end if;
  if exists (select 1 from public.roles where name='super_admin') then
    raise exception 'super_admin already exists. Review current installation before retrying.';
  end if;
end $$;

insert into public.roles(name) values ('super_admin');

-- No browser account can directly change this table. The checked RPC is the only write entrypoint.
create table inventory_private.role_permissions (
  role_id bigint not null references public.roles(id) on delete cascade,
  permission text not null check (permission = any(array[
    'dashboard:view','devices:view_own','devices:view_all','devices:manage',
    'assignments:view_own','assignments:view_all','assignments:manage',
    'users:manage','roles:assign_basic','roles:assign_admin','roles:manage',
    'permissions:manage','audit:view','settings:view'
  ])),
  primary key(role_id,permission)
);
revoke all on inventory_private.role_permissions from public,anon,authenticated,service_role;

insert into inventory_private.role_permissions(role_id,permission)
select r.id, v.permission from public.roles r cross join lateral
  (select unnest(case r.name
    when 'super_admin' then array[
      'dashboard:view','devices:view_own','devices:view_all','devices:manage',
      'assignments:view_own','assignments:view_all','assignments:manage',
      'users:manage','roles:assign_basic','roles:assign_admin','roles:manage',
      'permissions:manage','audit:view','settings:view']
    when 'admin' then array[
      'dashboard:view','devices:view_own','devices:view_all','devices:manage',
      'assignments:view_own','assignments:view_all','assignments:manage',
      'users:manage','roles:assign_basic','audit:view','settings:view']
    when 'device_manager' then array[
      'dashboard:view','devices:view_own','devices:view_all','devices:manage',
      'assignments:view_own','assignments:view_all','assignments:manage','settings:view']
    when 'employee' then array[
      'dashboard:view','devices:view_own','assignments:view_own','settings:view']
    else array[]::text[] end)) v(permission)
where r.name in ('super_admin','admin','device_manager','employee');

-- Existing application RPCs keep working for both admin and super_admin.
create or replace function inventory_private.require_user_admin()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  perform 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = caller and p.disabled_at is null and r.name in ('admin','super_admin')
    for share of p,r;
  if not found or not public.inventory_user_is_enabled()
    or not public.inventory_session_is_active() then
    raise exception using errcode='42501',message='Administrator with active session required';
  end if;
  return caller;
end $$;
revoke all on function inventory_private.require_user_admin() from public,anon,authenticated,service_role;

create function inventory_private.require_super_admin()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  perform 1 from public.profiles p join public.roles r on r.id=p.role_id
    where p.id=caller and p.disabled_at is null and r.name='super_admin'
    for share of p,r;
  if not found or not public.inventory_user_is_enabled()
    or not public.inventory_session_is_active() then
    raise exception using errcode='42501',message='Superadministrator with active session required';
  end if;
  return caller;
end $$;
revoke all on function inventory_private.require_super_admin() from public,anon,authenticated,service_role;

create table inventory_private.role_change_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_user_id uuid,
  target_role text,
  action text not null,
  logged_at timestamptz not null default now()
);
revoke all on inventory_private.role_change_audit from public,anon,authenticated,service_role;

-- Check and persist role assignment atomically, and revoke ALL active target sessions.
-- super_admin is never assignable or editable from the app; first bootstrap is manual.
create function public.inventory_admin_assign_role(target_id uuid, target_role text)
returns void language plpgsql security definer set search_path = ''
as $$
declare caller uuid; caller_role text; current_role text; wanted_id bigint;
begin
  caller := inventory_private.require_user_admin();
  select r.name into caller_role from public.profiles p join public.roles r on r.id=p.role_id where p.id=caller;
  if target_id is null or target_id=caller or target_role not in ('employee','device_manager','admin') or target_role is null then
    raise exception using errcode='22023',message='Invalid role assignment';
  end if;
  if caller_role <> 'super_admin' and target_role='admin' then
    raise exception using errcode='42501',message='Only a SuperAdmin can appoint an administrator';
  end if;
  select r.name into current_role from public.profiles p join public.roles r on r.id=p.role_id
    where p.id=target_id and p.disabled_at is null for update of p;
  if not found then raise exception using errcode='P0002',message='Active user not found'; end if;
  if current_role='super_admin' or (caller_role <> 'super_admin' and current_role='admin') then
    raise exception using errcode='42501',message='Protected administrative account';
  end if;
  if current_role=target_role then return; end if;
  select id into wanted_id from public.roles where name=target_role;
  if wanted_id is null then raise exception using errcode='22023',message='Invalid role'; end if;
  update public.profiles set role_id=wanted_id,updated_at=pg_catalog.now() where id=target_id;
  update inventory_private.sessions set revoked_at=coalesce(revoked_at,pg_catalog.now()) where user_id=target_id;
  insert into inventory_private.role_change_audit(actor_id,target_user_id,target_role,action)
    values(caller,target_id,target_role,'assign_role');
end $$;

-- Profile edits must not allow ordinary admins to administer administrators.
create or replace function public.inventory_admin_update_user(target_id uuid, given_name text, family_name text)
returns void language plpgsql security definer set search_path = ''
as $$
declare caller uuid; caller_role text; target_name text;
begin
  caller := inventory_private.require_user_admin();
  select r.name into caller_role from public.profiles p join public.roles r on r.id=p.role_id where p.id=caller;
  if given_name is null or family_name is null
    or length(trim(given_name)) not between 1 and 100
    or length(trim(family_name)) not between 1 and 100
    or given_name ~ '[[:cntrl:]]' or family_name ~ '[[:cntrl:]]' then
    raise exception using errcode='22023',message='Invalid name';
  end if;
  select r.name into target_name from public.profiles p join public.roles r on r.id=p.role_id where p.id=target_id for update of p;
  if not found then raise exception using errcode='P0002',message='User not found'; end if;
  if (target_name='super_admin' and target_id<>caller)
     or (caller_role<>'super_admin' and target_name in ('admin','super_admin') and target_id<>caller) then
    raise exception using errcode='42501',message='Protected administrative account';
  end if;
  update public.profiles set first_name=trim(given_name),last_name=trim(family_name),updated_at=pg_catalog.now()
    where id=target_id;
end $$;

create or replace function public.inventory_admin_disable_user(target_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare caller uuid; caller_role text; target_name text;
begin
  caller := inventory_private.require_user_admin();
  if target_id=caller then raise exception using errcode='22023',message='Self-deactivation is not allowed'; end if;
  select r.name into caller_role from public.profiles p join public.roles r on r.id=p.role_id where p.id=caller;
  select r.name into target_name from public.profiles p join public.roles r on r.id=p.role_id where p.id=target_id for update of p;
  if not found then raise exception using errcode='P0002',message='User not found'; end if;
  if target_name='super_admin' or (caller_role<>'super_admin' and target_name='admin') then
    raise exception using errcode='42501',message='Protected administrative account';
  end if;
  update public.profiles set disabled_at=coalesce(disabled_at,pg_catalog.now()),updated_at=pg_catalog.now() where id=target_id;
  update inventory_private.sessions set revoked_at=coalesce(revoked_at,pg_catalog.now()) where user_id=target_id;
end $$;

-- Dynamic operational permissions. Sensitive powers always fixed by the server role.
create function public.inventory_my_permissions()
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare granted text[];
begin
  if not public.inventory_user_is_enabled() or not public.inventory_session_is_active() then
    raise exception using errcode='42501',message='Active session required';
  end if;
  select coalesce(array_agg(rp.permission order by rp.permission),array[]::text[]) into granted
    from public.profiles p join inventory_private.role_permissions rp on rp.role_id=p.role_id
    where p.id=auth.uid() and p.disabled_at is null;
  return granted;
end $$;

create function public.inventory_superadmin_list_permissions()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare result jsonb;
begin
  perform inventory_private.require_super_admin();
  select coalesce(jsonb_object_agg(z.name,z.permissions), '{}'::jsonb) into result
  from (
    select r.name, coalesce(jsonb_agg(rp.permission order by rp.permission)
      filter(where rp.permission is not null), '[]'::jsonb) as permissions
    from public.roles r left join inventory_private.role_permissions rp on rp.role_id=r.id
    where r.name in ('admin','device_manager','employee') group by r.name
  ) z;
  return result;
end $$;

create function public.inventory_superadmin_update_permissions(target_role text, selected_permissions text[])
returns void language plpgsql security definer set search_path = ''
as $$
declare caller uuid; chosen_id bigint; value text; allowed text[] := array[
  'dashboard:view','devices:view_own','devices:view_all','devices:manage',
  'assignments:view_own','assignments:view_all','assignments:manage',
  'audit:view','settings:view'];
begin
  caller := inventory_private.require_super_admin();
  if target_role is null or target_role not in ('admin','device_manager','employee')
    or selected_permissions is null or cardinality(selected_permissions)>cardinality(allowed)
    or array_position(selected_permissions,null) is not null then
    raise exception using errcode='22023',message='Invalid permission change';
  end if;
  foreach value in array selected_permissions loop
    if value <> all(allowed) then
      raise exception using errcode='22023',message='Protected or unknown permission';
    end if;
  end loop;
  if (select count(distinct v.permission) from unnest(selected_permissions) as v(permission)) <> cardinality(selected_permissions) then
    raise exception using errcode='22023',message='Duplicate permission';
  end if;
  select id into chosen_id from public.roles where name=target_role for update;
  if not found then raise exception using errcode='22023',message='Unknown role'; end if;
  delete from inventory_private.role_permissions where role_id=chosen_id and permission=any(allowed);
  insert into inventory_private.role_permissions(role_id,permission)
    select chosen_id, unnest(selected_permissions);
  -- Existing sessions must reauthenticate before relying on updated permissions.
  update inventory_private.sessions set revoked_at=coalesce(revoked_at,pg_catalog.now())
    where user_id in (select id from public.profiles where role_id=chosen_id);
  insert into inventory_private.role_change_audit(actor_id,target_role,action)
    values(caller,target_role,'update_permissions');
end $$;

revoke all on function public.inventory_admin_assign_role(uuid,text),
  public.inventory_my_permissions(),public.inventory_superadmin_list_permissions(),
  public.inventory_superadmin_update_permissions(text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.inventory_admin_assign_role(uuid,text),
  public.inventory_my_permissions(),public.inventory_superadmin_list_permissions(),
  public.inventory_superadmin_update_permissions(text,text[]) to authenticated;
commit;
