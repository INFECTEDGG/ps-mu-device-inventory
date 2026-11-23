-- PBI-15 Audit-Log: lesende Prüfung VOR und NACH supabase/proposals/20261123_pbi_15_audit_log.sql.
-- Ändert keine Daten. Im Supabase SQL Editor vollständig ausführen; das Ergebnis
-- ist eine Tabelle (section, name, details), sortiert nach Abschnitt.
--
-- Vor der Installation erwartet:
--   prerequisite.*            = present (Sitzung, RBAC, inventory_private)
--   audit_column.*            = id, action, entity_type, entity_title, details, created_at
--                               (user_id/entity_id fehlen oder sind uuid)
--   data.null_required_fields = 0
--   data.orphan_user_ids      = 0 (oder Spalte user_id fehlt)
--   installed.audit_log_list  = missing
-- Nach der Installation erwartet:
--   installed.*               = present
--   trigger.inventory_audit_* vorhanden, legacy.* = missing
--   privilege.anon/authenticated.audit_logs = alles false
--   fk_delete_rule.audit_logs.audit_logs_user_id_fkey = SET NULL
select 'prerequisite' as section, f.name as name,
  case when pg_catalog.to_regprocedure(f.signature) is null then 'missing' else 'present' end as details
from (values
  ('auth.uid', 'auth.uid()'),
  ('inventory_user_is_enabled', 'public.inventory_user_is_enabled()'),
  ('inventory_session_is_active', 'public.inventory_session_is_active()'),
  ('inventory_my_permissions', 'public.inventory_my_permissions()'),
  ('inventory_superadmin_update_permissions', 'public.inventory_superadmin_update_permissions(text,text[])'),
  ('inventory_device_set_status', 'public.inventory_device_set_status(uuid,text)'),
  ('inventory_assign_device', 'public.inventory_assign_device(uuid,uuid)'),
  ('inventory_return_device', 'public.inventory_return_device(uuid)')
) f(name, signature)
union all
select 'prerequisite', 'schema.inventory_private',
  case when pg_catalog.to_regnamespace('inventory_private') is null then 'missing' else 'present' end
union all
select 'prerequisite', 'table.' || t.name,
  case when pg_catalog.to_regclass(t.name) is null then 'missing' else 'present' end
from (values
  ('public.audit_logs'), ('public.devices'), ('public.assignments'), ('public.profiles'),
  ('public.roles'), ('inventory_private.role_permissions'), ('inventory_private.role_change_audit')
) t(name)
union all
select 'installed', i.name,
  case when pg_catalog.to_regprocedure(i.signature) is null then 'missing' else 'present' end
from (values
  ('audit_log_list', 'public.inventory_audit_log_list(integer,text,text,uuid,text,timestamptz,timestamptz)'),
  ('audit_require_reader', 'inventory_private.audit_require_reader()'),
  ('write_audit_log', 'inventory_private.write_audit_log(uuid,text,text,uuid,text,jsonb)')
) i(name, signature)
union all
select 'audit_column', c.column_name::text,
  pg_catalog.concat('type=', c.data_type, '; nullable=', c.is_nullable, '; default=', c.column_default)
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'audit_logs'
union all
select 'constraint', r.relname || '.' || c.conname,
  pg_catalog.pg_get_constraintdef(c.oid)
from pg_catalog.pg_constraint c
join pg_catalog.pg_class r on r.oid = c.conrelid
join pg_catalog.pg_namespace n on n.oid = r.relnamespace
where n.nspname = 'public' and r.relname = 'audit_logs'
union all
-- Löschregeln aller Fremdschlüssel, die auf Profile oder Geräte zeigen.
select 'fk_delete_rule', r.relname || '.' || c.conname,
  pg_catalog.concat(
    case c.confdeltype
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
      when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end,
    ' -> ', c.confrelid::regclass::text)
from pg_catalog.pg_constraint c
join pg_catalog.pg_class r on r.oid = c.conrelid
join pg_catalog.pg_namespace n on n.oid = r.relnamespace
where c.contype = 'f' and n.nspname = 'public'
  and r.relname in ('audit_logs', 'devices', 'assignments', 'device_status_history', 'profiles')
union all
select 'index', i.indexname::text, i.indexdef
from pg_catalog.pg_indexes i
where i.schemaname = 'public' and i.tablename = 'audit_logs'
union all
select 'rls', c.relname::text,
  pg_catalog.concat('enabled=', c.relrowsecurity, '; forced=', c.relforcerowsecurity)
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'audit_logs'
union all
select 'policy', p.tablename || '.' || p.policyname,
  pg_catalog.concat(p.permissive, '; cmd=', p.cmd, '; roles=', p.roles::text, '; using=', p.qual)
from pg_catalog.pg_policies p
where p.schemaname = 'public' and p.tablename = 'audit_logs'
union all
select 'privilege', r.role_name || '.audit_logs',
  pg_catalog.concat(
    'select=', pg_catalog.has_table_privilege(r.role_name, 'public.audit_logs', 'SELECT'),
    '; insert=', pg_catalog.has_table_privilege(r.role_name, 'public.audit_logs', 'INSERT'),
    '; update=', pg_catalog.has_table_privilege(r.role_name, 'public.audit_logs', 'UPDATE'),
    '; delete=', pg_catalog.has_table_privilege(r.role_name, 'public.audit_logs', 'DELETE'),
    '; truncate=', pg_catalog.has_table_privilege(r.role_name, 'public.audit_logs', 'TRUNCATE'))
from (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
where exists (select 1 from pg_catalog.pg_roles x where x.rolname = r.role_name)
union all
select 'trigger', c.relname || '.' || t.tgname,
  pg_catalog.concat('enabled=', t.tgenabled, '; ', pg_catalog.pg_get_triggerdef(t.oid))
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and ((n.nspname = 'public' and c.relname in ('audit_logs', 'devices', 'assignments', 'profiles'))
    or (n.nspname = 'inventory_private' and c.relname = 'role_change_audit'))
union all
select 'function_grant', p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
  pg_catalog.concat('security_definer=', p.prosecdef,
    '; anon=', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
    '; authenticated=', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    '; config=', p.proconfig::text)
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname = 'inventory_audit_log_list')
   or (n.nspname = 'inventory_private'
     and (p.proname like 'audit%' or p.proname in ('write_audit_log', 'profile_label', 'try_uuid')))
union all
-- Objekte der nie gemergten Migrationen 20261024120000/20261024130000.
select 'legacy', 'schema.private',
  case when pg_catalog.to_regnamespace('private') is null then 'missing' else 'present' end
union all
select 'legacy', 'function.private.' || p.proname,
  pg_catalog.pg_get_function_identity_arguments(p.oid)
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
union all
select 'legacy', 'trigger.' || t.tgname,
  case when pg_catalog.count(x.oid) = 0 then 'missing' else 'present' end
from (values ('audit_device_changes'), ('audit_assignment_changes'), ('audit_profile_changes')) t(tgname)
left join pg_catalog.pg_trigger x on x.tgname = t.tgname and not x.tgisinternal
group by t.tgname
union all
select 'legacy', 'policy.audit_logs_admin_read',
  case when exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'audit_logs' and p.policyname = 'audit_logs_admin_read'
  ) then 'present' else 'missing' end
union all
-- Datenlage; über to_jsonb, damit die Abfrage auch ohne user_id/entity_id läuft.
select 'data', 'row_count', pg_catalog.count(*)::text
from public.audit_logs
union all
select 'data', 'null_required_fields', pg_catalog.count(*)::text
from public.audit_logs l
where l.action is null or l.entity_type is null or l.created_at is null
union all
select 'data', 'orphan_user_ids', pg_catalog.count(*)::text
from public.audit_logs l
where pg_catalog.to_jsonb(l) ->> 'user_id' is not null
  and not exists (
    select 1 from public.profiles p where p.id::text = pg_catalog.to_jsonb(l) ->> 'user_id'
  )
union all
select 'data', 'action.' || coalesce(l.action, '<NULL>'), pg_catalog.count(*)::text
from public.audit_logs l
group by l.action
order by section, name;
