-- Prüft Tabellen und Funktionen vor der Einrichtung der Sitzungssperre.
select 'protected_table' as section, c.relname::text as name,
  pg_catalog.concat('rls=', c.relrowsecurity, '; forced=', c.relforcerowsecurity, '; kind=', c.relkind) as details
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'roles', 'devices', 'assignments', 'device_status_history', 'audit_logs')
union all
select 'policy', p.tablename || '.' || p.policyname,
  pg_catalog.concat(p.permissive, '; cmd=', p.cmd, '; roles=', p.roles::text, '; using=', p.qual, '; check=', p.with_check)
from pg_catalog.pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('profiles', 'roles', 'devices', 'assignments', 'device_status_history', 'audit_logs')
union all
select 'public_function', p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
  pg_catalog.concat('security_definer=', p.prosecdef,
    '; anon_execute=', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
    '; authenticated_execute=', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
union all
select 'public_view', c.relname::text,
  pg_catalog.concat('kind=', c.relkind, '; options=', c.reloptions::text,
    '; anon_select=', pg_catalog.has_table_privilege('anon', c.oid, 'SELECT'),
    '; authenticated_select=', pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT'))
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm')
union all
select 'auth_session_column', column_name::text, data_type::text
from information_schema.columns
where table_schema = 'auth' and table_name = 'sessions'
union all
select 'private_schema', 'inventory_private_exists', exists (
  select 1 from pg_catalog.pg_namespace where nspname = 'inventory_private'
)::text
order by section, name;
