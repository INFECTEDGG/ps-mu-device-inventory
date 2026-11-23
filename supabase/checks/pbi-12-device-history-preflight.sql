-- PBI-12 Gerätehistorie: lesende Prüfung VOR und NACH supabase/proposals/20261123_pbi_12_device_history.sql.
-- Ändert keine Daten. Im Supabase SQL Editor vollständig ausführen; das Ergebnis
-- ist eine Tabelle (section, name, details), sortiert nach Abschnitt.
--
-- Vor der Installation erwartet:
--   prerequisite.*                 = present
--   column.*                       = alle Spalten aus der Spezifikation vorhanden
--   installed.device_history       = missing
--   data.closed_before_assigned    = 0, data.devices_with_multiple_active = 0
-- Nach der Installation erwartet:
--   installed.device_history       = present
--   trigger.inventory_* (Schutz vor UPDATE/DELETE/TRUNCATE) vorhanden
--   privilege.anon/authenticated.* = insert/update/delete/truncate=false
-- Hinweis: fk_delete_rule zeigt, ob das Löschen eines Profils Benutzerbezüge
-- auf NULL setzt (SET NULL) oder durch die Historie blockiert wird (NO ACTION).
select 'prerequisite' as section, f.name as name,
  case when pg_catalog.to_regprocedure(f.signature) is null then 'missing' else 'present' end as details
from (values
  ('auth.uid', 'auth.uid()'),
  ('inventory_user_is_enabled', 'public.inventory_user_is_enabled()'),
  ('inventory_session_is_active', 'public.inventory_session_is_active()'),
  ('inventory_my_permissions', 'public.inventory_my_permissions()'),
  ('inventory_device_set_status', 'public.inventory_device_set_status(uuid,text)'),
  ('inventory_assign_device', 'public.inventory_assign_device(uuid,uuid)'),
  ('inventory_return_device', 'public.inventory_return_device(uuid)'),
  ('inventory_assignments_overview', 'public.inventory_assignments_overview(text,integer)')
) f(name, signature)
union all
select 'prerequisite', 'schema.inventory_private',
  case when pg_catalog.to_regnamespace('inventory_private') is null then 'missing' else 'present' end
union all
select 'installed', 'device_history',
  case when pg_catalog.to_regprocedure('public.inventory_device_history(uuid)') is null
    then 'missing' else 'present' end
union all
select 'column', c.table_name || '.' || c.column_name,
  pg_catalog.concat('type=', c.data_type, '; nullable=', c.is_nullable, '; default=', c.column_default)
from information_schema.columns c
where c.table_schema = 'public'
  and (
    (c.table_name = 'assignments' and c.column_name in
      ('id', 'device_id', 'employee_id', 'assigned_by', 'assigned_at', 'returned_at', 'returned_by', 'created_at'))
    or (c.table_name = 'device_status_history' and c.column_name in
      ('id', 'device_id', 'old_status', 'new_status', 'changed_by', 'changed_at'))
    or (c.table_name = 'devices' and c.column_name in
      ('id', 'asset_tag', 'name', 'device_type', 'manufacture', 'model', 'status'))
  )
union all
select 'fk_delete_rule', r.relname || '.' || c.conname,
  pg_catalog.concat(
    case c.confdeltype
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
      when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end,
    ' -> ', c.confrelid::regclass::text, '; ', pg_catalog.pg_get_constraintdef(c.oid))
from pg_catalog.pg_constraint c
join pg_catalog.pg_class r on r.oid = c.conrelid
join pg_catalog.pg_namespace n on n.oid = r.relnamespace
where c.contype = 'f' and n.nspname = 'public'
  and r.relname in ('assignments', 'device_status_history')
union all
select 'constraint', r.relname || '.' || c.conname, pg_catalog.pg_get_constraintdef(c.oid)
from pg_catalog.pg_constraint c
join pg_catalog.pg_class r on r.oid = c.conrelid
join pg_catalog.pg_namespace n on n.oid = r.relnamespace
where c.contype in ('c', 'u', 'p') and n.nspname = 'public'
  and r.relname in ('assignments', 'device_status_history')
union all
select 'index', i.tablename || '.' || i.indexname, i.indexdef
from pg_catalog.pg_indexes i
where i.schemaname = 'public' and i.tablename in ('assignments', 'device_status_history')
union all
select 'trigger', c.relname || '.' || t.tgname,
  pg_catalog.concat('enabled=', t.tgenabled, '; ', pg_catalog.pg_get_triggerdef(t.oid))
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public'
  and c.relname in ('assignments', 'device_status_history')
union all
select 'policy', p.tablename || '.' || p.policyname,
  pg_catalog.concat(p.permissive, '; cmd=', p.cmd, '; roles=', p.roles::text, '; using=', p.qual)
from pg_catalog.pg_policies p
where p.schemaname = 'public' and p.tablename in ('assignments', 'device_status_history')
union all
select 'privilege', r.role_name || '.' || t.table_name,
  pg_catalog.concat(
    'select=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT'),
    '; insert=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT'),
    '; update=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE'),
    '; delete=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE'),
    '; truncate=', pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRUNCATE'))
from (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
cross join (values ('assignments'), ('device_status_history')) t(table_name)
where exists (select 1 from pg_catalog.pg_roles x where x.rolname = r.role_name)
union all
select 'function_grant', p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
  pg_catalog.concat('security_definer=', p.prosecdef,
    '; anon=', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
    '; authenticated=', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    '; config=', p.proconfig::text)
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname = 'inventory_device_history')
   or (n.nspname = 'inventory_private' and p.proname like 'preserve_%')
union all
select 'data', 'assignments_total', pg_catalog.count(*)::text from public.assignments
union all
select 'data', 'assignments_active', pg_catalog.count(*)::text
from public.assignments a where a.returned_at is null
union all
select 'data', 'assignments_closed', pg_catalog.count(*)::text
from public.assignments a where a.returned_at is not null
union all
select 'data', 'closed_before_assigned', pg_catalog.count(*)::text
from public.assignments a where a.returned_at < a.assigned_at
union all
select 'data', 'devices_with_multiple_active', pg_catalog.count(*)::text
from (
  select a.device_id from public.assignments a
  where a.returned_at is null group by a.device_id having pg_catalog.count(*) > 1
) multiple
union all
select 'data', 'status_history_total', pg_catalog.count(*)::text from public.device_status_history
union all
select 'data', 'status_history_without_user', pg_catalog.count(*)::text
from public.device_status_history h where h.changed_by is null
union all
select 'data', 'max_assignments_per_device', coalesce(pg_catalog.max(x.n), 0)::text
from (select pg_catalog.count(*) as n from public.assignments a group by a.device_id) x
union all
select 'data', 'max_status_changes_per_device', coalesce(pg_catalog.max(x.n), 0)::text
from (select pg_catalog.count(*) as n from public.device_status_history h group by h.device_id) x
order by section, name;
