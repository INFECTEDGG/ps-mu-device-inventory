-- Prüft Rollen, Profile und Rechte, ohne Daten zu ändern.
select 'role' as section, r.name::text as name, r.id::text as details
from public.roles r
union all
select 'profile_column', c.column_name::text,
  pg_catalog.concat(c.data_type, '; nullable=', c.is_nullable, '; default=', c.column_default)
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'profiles'
union all
select 'constraint', c.conname::text, pg_catalog.pg_get_constraintdef(c.oid)
from pg_catalog.pg_constraint c
where c.conrelid in ('public.roles'::regclass, 'public.profiles'::regclass)
union all
select 'trigger', t.tgname::text,
  pg_catalog.concat(t.tgenabled, '; ', pg_catalog.pg_get_triggerdef(t.oid))
from pg_catalog.pg_trigger t
where t.tgrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  and not t.tgisinternal
union all
select 'rls', c.relname::text,
  pg_catalog.concat('enabled=', c.relrowsecurity, '; forced=', c.relforcerowsecurity)
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('profiles', 'roles')
union all
select 'policy', p.tablename || '.' || p.policyname,
  pg_catalog.concat('roles=', p.roles::text, '; cmd=', p.cmd, '; using=', p.qual, '; check=', p.with_check)
from pg_catalog.pg_policies p
where p.schemaname = 'public' and p.tablename in ('profiles', 'roles')
union all
select 'privilege', r.role_name || '.' || t.table_name,
  pg_catalog.concat(
    'select=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT'),
    '; insert=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT'),
    '; delete=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE'),
    '; update=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE'))
from (values ('anon'), ('authenticated')) r(role_name)
cross join (values ('profiles'), ('roles')) t(table_name)
union all
select 'profiles', 'missing_profile_count', pg_catalog.count(*)::text
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
union all
select 'integrity', 'roles_name_unique', exists (
  select 1
  from pg_catalog.pg_index i
  join pg_catalog.pg_attribute a
    on a.attrelid = i.indrelid and a.attname = 'name' and not a.attisdropped
  where i.indrelid = 'public.roles'::regclass
    and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
    and i.indpred is null and i.indexprs is null
    and i.indnkeyatts = 1 and i.indkey[0] = a.attnum
)::text
order by section, name;
