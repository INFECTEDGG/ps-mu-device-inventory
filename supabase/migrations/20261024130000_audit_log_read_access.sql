-- Audit-Log lesen (Issue #16, FA-21)
--
-- Nur Administratoren dürfen Audit-Einträge lesen. Die Prüfung erfolgt per Row
-- Level Security und gilt für alle Zugriffe mit Benutzersitzung, also über die
-- Supabase-API oder ein Backend, das mit dem JWT des Benutzers anfragt. Ein
-- Backend mit Service-Key umgeht RLS und muss die Rolle selbst prüfen.

create or replace function private.has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and r.name = role_name
  )
$$;

revoke all on function private.has_role(text) from public, anon;
grant execute on function private.has_role(text) to authenticated;

drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read
  on public.audit_logs
  for select
  to authenticated
  using ((select private.has_role('admin')));
