-- Audit-Logging (Issue #15, FA-20)
--
-- Relevante Änderungen an Geräten, Zuweisungen und Benutzern werden per Trigger
-- automatisch in public.audit_logs protokolliert: wer (user_id), was (action,
-- entity_*, details) und wann (created_at). Der Eintrag wird in derselben
-- Transaktion wie die Änderung geschrieben und bei einem Rollback verworfen.
--
-- Der ausführende Benutzer wird über auth.uid() aus dem Supabase-JWT ermittelt.
-- Bei Zuweisungen dienen assigned_by bzw. returned_by als Rückfallwert, falls
-- ohne Benutzersitzung geschrieben wird (z. B. Backend mit Service-Key).

-- 1. Tabelle audit_logs um Benutzer und Objekt-ID ergänzen

alter table public.audit_logs
  add column if not exists user_id uuid references public.profiles (id) on delete set null,
  add column if not exists entity_id uuid;

alter table public.audit_logs
  alter column action set not null,
  alter column entity_type set not null,
  alter column details type jsonb using details::jsonb,
  alter column details set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column created_at set not null;

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);

create index if not exists audit_logs_user_id_idx
  on public.audit_logs (user_id);

-- 2. Audit-Log vor Manipulation schützen
--
-- Anwendungsbenutzer dürfen keine Einträge schreiben, ändern oder löschen;
-- geschrieben wird ausschließlich über die Trigger. Ohne SELECT-Policy ist das
-- Log für anon/authenticated außerdem nicht lesbar. Die Leseberechtigung für
-- Administratoren folgt mit Issue #16 (FA-21).

alter table public.audit_logs enable row level security;

revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;

-- 3. Hilfsfunktionen im nicht über die API erreichbaren Schema private

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.audit_changes(
  old_row jsonb,
  new_row jsonb,
  ignored_columns text[] default '{}'
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(
      changed.key,
      jsonb_build_object('old', old_row -> changed.key, 'new', changed.value)
    ),
    '{}'::jsonb
  )
  from jsonb_each(new_row) as changed
  where changed.key <> all (ignored_columns)
    and changed.value is distinct from old_row -> changed.key
$$;

create or replace function private.write_audit_log(
  actor_id uuid,
  action text,
  entity_type text,
  entity_id uuid,
  entity_title text,
  details jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_logs (user_id, action, entity_type, entity_id, entity_title, details)
  values (actor_id, action, entity_type, entity_id, entity_title, coalesce(details, '{}'::jsonb))
$$;

revoke all on function private.audit_changes(jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function private.write_audit_log(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;

-- 4. Geräte: DEVICE_CREATED, DEVICE_UPDATED, DEVICE_STATUS_CHANGED, DEVICE_DELETED

create or replace function private.audit_device_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit_log(
      auth.uid(), 'DEVICE_CREATED', 'device', new.id, new.asset_tag,
      to_jsonb(new) - array['id', 'created_at', 'updated_at']
    );
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      perform private.write_audit_log(
        auth.uid(), 'DEVICE_STATUS_CHANGED', 'device', new.id, new.asset_tag,
        jsonb_build_object('old_status', old.status, 'new_status', new.status)
      );
    end if;

    changes := private.audit_changes(to_jsonb(old), to_jsonb(new), array['status', 'updated_at']);
    if changes <> '{}'::jsonb then
      perform private.write_audit_log(
        auth.uid(), 'DEVICE_UPDATED', 'device', new.id, new.asset_tag,
        jsonb_build_object('changes', changes)
      );
    end if;
  else
    perform private.write_audit_log(
      auth.uid(), 'DEVICE_DELETED', 'device', old.id, old.asset_tag,
      to_jsonb(old) - array['id', 'created_at', 'updated_at']
    );
  end if;

  return null;
end;
$$;

drop trigger if exists audit_device_changes on public.devices;
create trigger audit_device_changes
  after insert or update or delete on public.devices
  for each row execute function private.audit_device_changes();

-- 5. Zuweisungen: DEVICE_ASSIGNED, DEVICE_RETURNED, ASSIGNMENT_UPDATED, ASSIGNMENT_DELETED
--
-- Zuweisungen werden beim Gerät protokolliert (entity_type 'device'), damit die
-- Gerätedetailseite alle Einträge eines Gerätes über entity_id abfragen kann.

create or replace function private.audit_assignment_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_title text;
  changes jsonb;
begin
  if tg_op = 'DELETE' then
    select d.asset_tag into device_title from public.devices d where d.id = old.device_id;

    perform private.write_audit_log(
      auth.uid(), 'ASSIGNMENT_DELETED', 'device', old.device_id, device_title,
      jsonb_build_object('assignment_id', old.id) || (to_jsonb(old) - array['id', 'device_id', 'created_at'])
    );
    return null;
  end if;

  select d.asset_tag into device_title from public.devices d where d.id = new.device_id;

  if tg_op = 'INSERT' then
    perform private.write_audit_log(
      coalesce(auth.uid(), new.assigned_by), 'DEVICE_ASSIGNED', 'device', new.device_id, device_title,
      jsonb_build_object(
        'assignment_id', new.id,
        'employee_id', new.employee_id,
        'assigned_at', new.assigned_at
      )
    );
  elsif old.returned_at is null and new.returned_at is not null then
    perform private.write_audit_log(
      coalesce(auth.uid(), new.returned_by), 'DEVICE_RETURNED', 'device', new.device_id, device_title,
      jsonb_build_object(
        'assignment_id', new.id,
        'employee_id', new.employee_id,
        'returned_at', new.returned_at
      )
    );
  else
    changes := private.audit_changes(to_jsonb(old), to_jsonb(new));
    if changes <> '{}'::jsonb then
      perform private.write_audit_log(
        auth.uid(), 'ASSIGNMENT_UPDATED', 'device', new.device_id, device_title,
        jsonb_build_object('assignment_id', new.id, 'changes', changes)
      );
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists audit_assignment_changes on public.assignments;
create trigger audit_assignment_changes
  after insert or update or delete on public.assignments
  for each row execute function private.audit_assignment_changes();

-- 6. Benutzer: USER_CREATED, USER_UPDATED, USER_ROLE_CHANGED, USER_DELETED

create or replace function private.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit_log(
      auth.uid(), 'USER_CREATED', 'user', new.id, concat_ws(' ', new.first_name, new.last_name),
      (to_jsonb(new) - array['id', 'created_at', 'updated_at'])
        || jsonb_build_object('role', (select r.name from public.roles r where r.id = new.role_id))
    );
  elsif tg_op = 'UPDATE' then
    if new.role_id is distinct from old.role_id then
      perform private.write_audit_log(
        auth.uid(), 'USER_ROLE_CHANGED', 'user', new.id, concat_ws(' ', new.first_name, new.last_name),
        jsonb_build_object(
          'old_role', (select r.name from public.roles r where r.id = old.role_id),
          'new_role', (select r.name from public.roles r where r.id = new.role_id)
        )
      );
    end if;

    changes := private.audit_changes(to_jsonb(old), to_jsonb(new), array['role_id', 'updated_at']);
    if changes <> '{}'::jsonb then
      perform private.write_audit_log(
        auth.uid(), 'USER_UPDATED', 'user', new.id, concat_ws(' ', new.first_name, new.last_name),
        jsonb_build_object('changes', changes)
      );
    end if;
  else
    perform private.write_audit_log(
      auth.uid(), 'USER_DELETED', 'user', old.id, concat_ws(' ', old.first_name, old.last_name),
      to_jsonb(old) - array['id', 'created_at', 'updated_at']
    );
  end if;

  return null;
end;
$$;

drop trigger if exists audit_profile_changes on public.profiles;
create trigger audit_profile_changes
  after insert or update or delete on public.profiles
  for each row execute function private.audit_profile_changes();
