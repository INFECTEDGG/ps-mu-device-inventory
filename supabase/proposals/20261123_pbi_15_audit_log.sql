-- PBI-15: Audit-Log erstellen und anzeigen (FA-20, FA-21)
--
-- VORSCHLAG: nur nach Review und Backup manuell im Supabase SQL Editor ausführen.
-- Reihenfolge:
--   1. supabase/checks/pbi-15-audit-log-preflight.sql lesend ausführen und prüfen.
--   2. Diese Datei VOLLSTÄNDIG ausführen (eine Transaktion; bei einem Fehler wird
--      nichts geändert).
--   3. Danach supabase/proposals/20261123_pbi_12_device_history.sql.
-- Voraussetzungen: Server-Sitzung, Benutzerverwaltung, SuperAdmin-Berechtigungen,
-- Gerätestatus sowie Zuweisung/Rücknahme (Issues #8, #10, #11) sind installiert.
--
-- Ersetzt die nie gemergten Migrationen 20261024120000_audit_logging.sql und
-- 20261024130000_audit_log_read_access.sql. Die Datei funktioniert unabhängig
-- davon, ob diese alten Migrationen bereits ausgeführt wurden: deren Trigger,
-- Funktionen, Policy und das Schema private (sofern leer) werden entfernt.
--
-- Ergebnis:
-- * Trigger protokollieren relevante Änderungen an Geräten, Zuweisungen,
--   Benutzerprofilen und Rollenberechtigungen in public.audit_logs: ausführender
--   Benutzer (user_id), Aktion, betroffenes Objekt und Zeitpunkt. Der Eintrag
--   entsteht in derselben Transaktion wie die fachliche Änderung; ein Rollback
--   verwirft beides (NFA-06).
-- * Niemand schreibt, ändert oder löscht Audit-Einträge direkt (auch kein
--   Superuser per UPDATE/DELETE/TRUNCATE). Einzige Ausnahme: ON DELETE SET NULL
--   für user_id, wenn ein Profil gelöscht wird.
-- * Lesen ausschließlich über public.inventory_audit_log_list() für aktive
--   Administratoren/SuperAdmins mit der Berechtigung audit:view.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  needed text;
  column_type regtype;
  blockers text;
BEGIN
  -- 1. Voraussetzungen: Auth, Sitzung und RBAC
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('public.inventory_user_is_enabled()') IS NULL
     OR pg_catalog.to_regprocedure('public.inventory_session_is_active()') IS NULL
     OR pg_catalog.to_regprocedure('public.inventory_my_permissions()') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: auth.uid() oder die Sitzungs-/RBAC-Funktionen fehlen.',
      HINT = 'Zuerst Server-Sitzung, Benutzerverwaltung und SuperAdmin-Berechtigungen installieren.';
  END IF;
  IF pg_catalog.to_regnamespace('inventory_private') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: das private Schema inventory_private fehlt.',
      HINT = 'Die Migration 20261026120000_server_session_inactivity.sql muss installiert sein.';
  END IF;
  IF pg_catalog.to_regclass('inventory_private.role_change_audit') IS NOT NULL
     AND pg_catalog.to_regclass('inventory_private.role_permissions') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: inventory_private.role_permissions fehlt, obwohl role_change_audit existiert.';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: die Supabase-Rollen anon, authenticated und service_role werden benötigt.';
  END IF;

  -- 2. Tabellen und Spalten
  FOREACH needed IN ARRAY ARRAY['audit_logs', 'devices', 'assignments', 'profiles', 'roles'] LOOP
    IF pg_catalog.to_regclass('public.' || needed) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-15: die Tabelle public.%s fehlt.', needed);
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['id', 'action', 'entity_type', 'entity_title', 'details', 'created_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = needed) THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-15: die Spalte audit_logs.%s fehlt.', needed);
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['user_id', 'entity_id'] LOOP
    SELECT a.atttypid::regtype INTO column_type
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.audit_logs'::regclass AND a.attname = needed
      AND a.attnum > 0 AND NOT a.attisdropped;
    IF FOUND AND column_type IS DISTINCT FROM 'uuid'::regtype THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-15: audit_logs.%s existiert bereits, ist aber nicht vom Typ uuid (%s).', needed, column_type),
        HINT = 'Spaltentyp und vorhandene Daten zuerst im Team klären.';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'id'
      AND (column_default IS NOT NULL OR is_identity = 'YES')) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: audit_logs.id benötigt einen Standardwert (z. B. gen_random_uuid()).';
  END IF;
  FOREACH needed IN ARRAY ARRAY['id', 'status', 'asset_tag', 'created_at', 'updated_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = needed) THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-15: die Spalte devices.%s fehlt.', needed);
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['id', 'device_id', 'employee_id', 'assigned_by', 'assigned_at', 'returned_at', 'returned_by'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'assignments' AND column_name = needed) THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-15: die Spalte assignments.%s fehlt.', needed);
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['id', 'role_id', 'first_name', 'last_name', 'disabled_at', 'updated_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = needed) THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-15: die Spalte profiles.%s fehlt.', needed);
    END IF;
  END LOOP;

  -- 3. Keine zweite Ausführung und keine fremden Objekte überschreiben
  IF pg_catalog.to_regprocedure('public.inventory_audit_log_list(integer,text,text,uuid,text,timestamptz,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: public.inventory_audit_log_list existiert bereits – das Proposal wurde offenbar schon ausgeführt.',
      HINT = 'Installierten Stand mit supabase/checks/pbi-15-audit-log-preflight.sql prüfen; nichts wurde geändert.';
  END IF;
  SELECT pg_catalog.string_agg(p.proname::text, ', ' ORDER BY p.proname) INTO blockers
  FROM pg_catalog.pg_proc p
  WHERE p.pronamespace = 'inventory_private'::regnamespace
    AND p.proname IN ('audit_changes', 'audit_actor', 'profile_label', 'try_uuid', 'write_audit_log',
      'audit_device_change', 'audit_assignment_change', 'audit_profile_change',
      'audit_role_permission_change', 'audit_logs_guard', 'audit_require_reader');
  IF blockers IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: Funktionen mit den vorgesehenen Namen existieren bereits in inventory_private.',
      DETAIL = blockers;
  END IF;

  -- Alte Objekte dürfen nur von den alten Triggern bzw. der alten Policy verwendet werden.
  SELECT pg_catalog.string_agg(pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO blockers
  FROM pg_catalog.pg_depend d
  WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass
    AND d.refobjid IN (
      SELECT f.oid FROM pg_catalog.pg_proc f
      JOIN pg_catalog.pg_namespace n ON n.oid = f.pronamespace
      WHERE n.nspname = 'private'
        AND f.proname IN ('audit_device_changes', 'audit_assignment_changes', 'audit_profile_changes',
          'write_audit_log', 'audit_changes', 'has_role'))
    AND d.deptype = 'n'
    AND NOT (d.classid = 'pg_catalog.pg_trigger'::regclass AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.oid = d.objid
        AND t.tgname IN ('audit_device_changes', 'audit_assignment_changes', 'audit_profile_changes')))
    AND NOT (d.classid = 'pg_catalog.pg_policy'::regclass AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      WHERE pol.oid = d.objid AND pol.polname = 'audit_logs_admin_read'
        AND pol.polrelid = 'public.audit_logs'::regclass));
  IF blockers IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: Funktionen der alten Audit-Migration werden noch von anderen Objekten verwendet.',
      DETAIL = blockers,
      HINT = 'Abhängigkeiten zuerst im Team klären; die alten Funktionen werden nicht mit CASCADE gelöscht.';
  END IF;

  -- 4. Schreibzugriffe während der Installation sperren, danach Daten prüfen.
  LOCK TABLE public.audit_logs, public.devices, public.assignments, public.profiles
    IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM public.audit_logs l
    WHERE l.action IS NULL OR l.entity_type IS NULL OR l.created_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-15: audit_logs enthält Einträge ohne action, entity_type oder created_at.',
      HINT = 'Diese Altdaten zuerst prüfen und im Team bereinigen; die Spalten werden NOT NULL.';
  END IF;

  SELECT a.atttypid::regtype INTO column_type
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.audit_logs'::regclass AND a.attname = 'details'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF column_type IS DISTINCT FROM 'jsonb'::regtype THEN
    BEGIN
      PERFORM l.details::jsonb FROM public.audit_logs l;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-15: audit_logs.details (%s) enthält Werte, die kein gültiges JSON sind.', column_type),
        HINT = 'Die Spalte wird in jsonb umgewandelt; ungültige Altdaten zuerst bereinigen.';
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'user_id') THEN
    -- Dynamisch, weil die Spalte vor der ersten Installation fehlen kann.
    EXECUTE 'SELECT pg_catalog.count(*)::text FROM public.audit_logs l
             WHERE l.user_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.user_id)'
      INTO blockers;
    IF blockers <> '0' THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-15: %s Audit-Einträge verweisen auf nicht vorhandene Profile.', blockers),
        HINT = 'Der Fremdschlüssel audit_logs.user_id -> profiles.id (ON DELETE SET NULL) kann sonst nicht angelegt werden.';
    END IF;
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Tabelle audit_logs: Benutzer- und Objektbezug, Pflichtfelder, Indizes
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entity_id uuid;

-- Bestand vereinheitlichen: genau ein Fremdschlüssel user_id -> profiles.id mit
-- ON DELETE SET NULL. Andere Löschregeln würden das Löschen eines Profils
-- blockieren (NO ACTION/RESTRICT) oder Audit-Einträge löschen (CASCADE).
DO $user_fk$
DECLARE
  fk record;
  user_column smallint;
  keep_existing boolean := false;
BEGIN
  SELECT a.attnum INTO user_column FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.audit_logs'::regclass AND a.attname = 'user_id' AND NOT a.attisdropped;

  FOR fk IN
    SELECT c.conname, c.confrelid, c.confdeltype
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.audit_logs'::regclass AND c.contype = 'f'
      AND c.conkey = ARRAY[user_column]
    ORDER BY c.conname
  LOOP
    IF NOT keep_existing AND fk.confrelid = 'public.profiles'::regclass AND fk.confdeltype = 'n' THEN
      keep_existing := true;
    ELSE
      EXECUTE pg_catalog.format('ALTER TABLE public.audit_logs DROP CONSTRAINT %I', fk.conname);
    END IF;
  END LOOP;

  IF NOT keep_existing THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE SET NULL;
  END IF;
END;
$user_fk$;

DO $details$
BEGIN
  IF (SELECT a.atttypid FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.audit_logs'::regclass AND a.attname = 'details'
        AND NOT a.attisdropped) <> 'jsonb'::regtype THEN
    ALTER TABLE public.audit_logs ALTER COLUMN details TYPE jsonb USING details::jsonb;
  END IF;
END;
$details$;

ALTER TABLE public.audit_logs
  ALTER COLUMN action SET NOT NULL,
  ALTER COLUMN entity_type SET NOT NULL,
  ALTER COLUMN details SET DEFAULT '{}'::jsonb,
  ALTER COLUMN created_at SET DEFAULT pg_catalog.now(),
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON public.audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx
  ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx
  ON public.audit_logs (action);

-- ---------------------------------------------------------------------------
-- 2. Rechte: kein direkter Zugriff aus dem Browser, Lesen nur über die RPC
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
-- Auch der Service-Key schreibt nie direkt; Einträge entstehen nur über Trigger.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.audit_logs FROM service_role;

-- ---------------------------------------------------------------------------
-- 3. Objekte der alten Migrationen entfernen (falls vorhanden)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_device_changes ON public.devices;
DROP TRIGGER IF EXISTS audit_assignment_changes ON public.assignments;
DROP TRIGGER IF EXISTS audit_profile_changes ON public.profiles;
DROP FUNCTION IF EXISTS private.audit_device_changes();
DROP FUNCTION IF EXISTS private.audit_assignment_changes();
DROP FUNCTION IF EXISTS private.audit_profile_changes();
DROP FUNCTION IF EXISTS private.write_audit_log(uuid, text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS private.audit_changes(jsonb, jsonb, text[]);
DROP FUNCTION IF EXISTS private.has_role(text);

DO $cleanup$
BEGIN
  IF pg_catalog.to_regnamespace('private') IS NOT NULL THEN
    BEGIN
      -- RESTRICT: nur ein leeres Schema wird entfernt.
      DROP SCHEMA private RESTRICT;
    EXCEPTION WHEN dependent_objects_still_exist THEN
      RAISE NOTICE 'PBI-15: Schema private enthält weitere Objekte und bleibt erhalten.';
    END;
  END IF;
END;
$cleanup$;

-- ---------------------------------------------------------------------------
-- 4. Hilfsfunktionen im nicht über die API erreichbaren Schema inventory_private
-- ---------------------------------------------------------------------------

-- Geänderte Felder als {"spalte": {"old": …, "new": …}}.
CREATE FUNCTION inventory_private.audit_changes(
  old_row jsonb,
  new_row jsonb,
  ignored_columns text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT coalesce(
    pg_catalog.jsonb_object_agg(
      changed.key,
      pg_catalog.jsonb_build_object('old', old_row -> changed.key, 'new', changed.value)
    ),
    '{}'::jsonb
  )
  FROM pg_catalog.jsonb_each(new_row) AS changed
  WHERE changed.key <> ALL (coalesce(ignored_columns, '{}'::text[]))
    AND changed.value IS DISTINCT FROM old_row -> changed.key
$function$;

-- Wandelt Text nur bei gültigem UUID-Format um, sonst NULL (kein Abbruch).
CREATE FUNCTION inventory_private.try_uuid(candidate text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN candidate::uuid
  END
$function$;

-- Ausführender Benutzer: auth.uid(), sonst der fachliche Rückfallwert. Nur IDs
-- mit Profil werden verwendet, damit der Fremdschlüssel nie die eigentliche
-- Änderung abbricht.
CREATE FUNCTION inventory_private.audit_actor(fallback uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id FROM public.profiles p WHERE p.id = coalesce(auth.uid(), fallback)
$function$;

-- "Vorname Nachname", sonst E-Mail-Adresse, sonst NULL.
CREATE FUNCTION inventory_private.profile_label(profile_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT coalesce(
    (SELECT nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.first_name, p.last_name)), '')
     FROM public.profiles p WHERE p.id = profile_id),
    (SELECT u.email::text FROM auth.users u WHERE u.id = profile_id)
  )
$function$;

-- Einziger Schreibweg in public.audit_logs. clock_timestamp() sorgt dafür, dass
-- mehrere Einträge derselben Transaktion in der richtigen Reihenfolge stehen.
CREATE FUNCTION inventory_private.write_audit_log(
  actor uuid,
  action text,
  entity_type text,
  entity_id uuid,
  entity_title text,
  details jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, entity_title, details, created_at)
  VALUES (
    write_audit_log.actor,
    write_audit_log.action,
    write_audit_log.entity_type,
    write_audit_log.entity_id,
    write_audit_log.entity_title,
    coalesce(write_audit_log.details, '{}'::jsonb),
    pg_catalog.clock_timestamp()
  )
$function$;

-- ---------------------------------------------------------------------------
-- 5. Trigger: Geräte, Zuweisungen, Benutzer und Rollenberechtigungen
-- ---------------------------------------------------------------------------

-- Geräte: DEVICE_CREATED, DEVICE_STATUS_CHANGED, DEVICE_UPDATED, DEVICE_DELETED
CREATE FUNCTION inventory_private.audit_device_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  old_row jsonb;
  new_row jsonb;
  changes jsonb;
  actor uuid;
BEGIN
  IF tg_op = 'INSERT' THEN
    new_row := pg_catalog.to_jsonb(new);
    -- created_by existiert nicht in jeder Installation, daher über JSON gelesen.
    actor := inventory_private.audit_actor(inventory_private.try_uuid(new_row ->> 'created_by'));
    PERFORM inventory_private.write_audit_log(
      actor, 'DEVICE_CREATED', 'device', new.id, new.asset_tag,
      pg_catalog.jsonb_strip_nulls(new_row - ARRAY['id', 'created_at', 'updated_at']::text[])
    );
    RETURN NULL;
  END IF;

  IF tg_op = 'DELETE' THEN
    old_row := pg_catalog.to_jsonb(old);
    PERFORM inventory_private.write_audit_log(
      inventory_private.audit_actor(), 'DEVICE_DELETED', 'device', old.id, old.asset_tag,
      pg_catalog.jsonb_strip_nulls(old_row - ARRAY['id', 'created_at', 'updated_at']::text[])
    );
    RETURN NULL;
  END IF;

  actor := inventory_private.audit_actor();
  IF new.status IS DISTINCT FROM old.status THEN
    PERFORM inventory_private.write_audit_log(
      actor, 'DEVICE_STATUS_CHANGED', 'device', new.id, new.asset_tag,
      pg_catalog.jsonb_build_object('old_status', old.status, 'new_status', new.status)
    );
  END IF;

  changes := inventory_private.audit_changes(
    pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new), ARRAY['status', 'updated_at']::text[]
  );
  IF changes <> '{}'::jsonb THEN
    PERFORM inventory_private.write_audit_log(
      actor, 'DEVICE_UPDATED', 'device', new.id, new.asset_tag,
      pg_catalog.jsonb_build_object('changes', changes)
    );
  END IF;
  RETURN NULL;
END;
$function$;

-- Zuweisungen werden beim Gerät protokolliert (entity_type 'device'), damit die
-- Gerätedetailseite alle Einträge eines Gerätes über entity_id findet.
-- DEVICE_ASSIGNED, DEVICE_RETURNED, ASSIGNMENT_UPDATED, ASSIGNMENT_DELETED
CREATE FUNCTION inventory_private.audit_assignment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  device_title text;
  changes jsonb;
BEGIN
  IF tg_op = 'DELETE' THEN
    SELECT d.asset_tag INTO device_title FROM public.devices d WHERE d.id = old.device_id;
    PERFORM inventory_private.write_audit_log(
      inventory_private.audit_actor(), 'ASSIGNMENT_DELETED', 'device', old.device_id, device_title,
      pg_catalog.jsonb_build_object(
        'assignment_id', old.id,
        'employee_id', old.employee_id,
        'employee_name', inventory_private.profile_label(old.employee_id),
        'assigned_at', old.assigned_at,
        'returned_at', old.returned_at
      )
    );
    RETURN NULL;
  END IF;

  SELECT d.asset_tag INTO device_title FROM public.devices d WHERE d.id = new.device_id;

  IF tg_op = 'INSERT' THEN
    PERFORM inventory_private.write_audit_log(
      inventory_private.audit_actor(new.assigned_by), 'DEVICE_ASSIGNED', 'device', new.device_id, device_title,
      pg_catalog.jsonb_build_object(
        'assignment_id', new.id,
        'employee_id', new.employee_id,
        'employee_name', inventory_private.profile_label(new.employee_id),
        'assigned_at', new.assigned_at
      )
    );
    RETURN NULL;
  END IF;

  IF old.returned_at IS NULL AND new.returned_at IS NOT NULL THEN
    PERFORM inventory_private.write_audit_log(
      inventory_private.audit_actor(new.returned_by), 'DEVICE_RETURNED', 'device', new.device_id, device_title,
      pg_catalog.jsonb_build_object(
        'assignment_id', new.id,
        'employee_id', new.employee_id,
        'employee_name', inventory_private.profile_label(new.employee_id),
        'assigned_at', new.assigned_at,
        'returned_at', new.returned_at
      )
    );
    -- Weitere Korrekturen in derselben Anweisung gehen nicht verloren.
    changes := inventory_private.audit_changes(
      pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new),
      ARRAY['returned_at', 'returned_by', 'updated_at']::text[]
    );
  ELSE
    changes := inventory_private.audit_changes(
      pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new), ARRAY['updated_at']::text[]
    );
  END IF;

  IF changes <> '{}'::jsonb THEN
    PERFORM inventory_private.write_audit_log(
      inventory_private.audit_actor(), 'ASSIGNMENT_UPDATED', 'device', new.device_id, device_title,
      pg_catalog.jsonb_build_object('assignment_id', new.id, 'changes', changes)
    );
  END IF;
  RETURN NULL;
END;
$function$;

-- Benutzer: USER_CREATED, USER_ROLE_CHANGED, USER_DISABLED, USER_ENABLED,
-- USER_UPDATED, USER_DELETED
CREATE FUNCTION inventory_private.audit_profile_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  account_email text;
  creator uuid;
  old_role text;
  new_role text;
  title text;
  actor uuid;
  ignored text[];
  changes jsonb;
BEGIN
  IF tg_op = 'INSERT' THEN
    -- Konten entstehen über Supabase Auth ohne Benutzersitzung. Ein Backend kann
    -- den anlegenden Administrator in app_metadata.created_by hinterlegen.
    SELECT u.email::text,
           inventory_private.try_uuid(pg_catalog.to_jsonb(u) -> 'raw_app_meta_data' ->> 'created_by')
      INTO account_email, creator
    FROM auth.users u WHERE u.id = new.id;
    SELECT r.name INTO new_role FROM public.roles r WHERE r.id = new.role_id;
    title := coalesce(
      nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', new.first_name, new.last_name)), ''),
      account_email
    );
    PERFORM inventory_private.write_audit_log(
      inventory_private.audit_actor(creator), 'USER_CREATED', 'user', new.id, title,
      pg_catalog.jsonb_build_object(
        'first_name', new.first_name,
        'last_name', new.last_name,
        'role', new_role,
        'email', account_email
      )
    );
    RETURN NULL;
  END IF;

  IF tg_op = 'DELETE' THEN
    SELECT u.email::text INTO account_email FROM auth.users u WHERE u.id = old.id;
    SELECT r.name INTO old_role FROM public.roles r WHERE r.id = old.role_id;
    title := coalesce(
      nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', old.first_name, old.last_name)), ''),
      account_email
    );
    PERFORM inventory_private.write_audit_log(
      inventory_private.audit_actor(), 'USER_DELETED', 'user', old.id, title,
      pg_catalog.jsonb_build_object(
        'first_name', old.first_name,
        'last_name', old.last_name,
        'role', old_role,
        'email', account_email
      )
    );
    RETURN NULL;
  END IF;

  SELECT u.email::text INTO account_email FROM auth.users u WHERE u.id = new.id;
  title := coalesce(
    nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', new.first_name, new.last_name)), ''),
    account_email
  );
  actor := inventory_private.audit_actor();

  IF new.role_id IS DISTINCT FROM old.role_id THEN
    SELECT r.name INTO old_role FROM public.roles r WHERE r.id = old.role_id;
    SELECT r.name INTO new_role FROM public.roles r WHERE r.id = new.role_id;
    PERFORM inventory_private.write_audit_log(
      actor, 'USER_ROLE_CHANGED', 'user', new.id, title,
      pg_catalog.jsonb_build_object('old_role', old_role, 'new_role', new_role)
    );
  END IF;

  ignored := ARRAY['role_id', 'updated_at']::text[];
  IF old.disabled_at IS NULL AND new.disabled_at IS NOT NULL THEN
    PERFORM inventory_private.write_audit_log(
      actor, 'USER_DISABLED', 'user', new.id, title,
      pg_catalog.jsonb_build_object('disabled_at', new.disabled_at)
    );
    ignored := ignored || 'disabled_at'::text;
  ELSIF old.disabled_at IS NOT NULL AND new.disabled_at IS NULL THEN
    PERFORM inventory_private.write_audit_log(
      actor, 'USER_ENABLED', 'user', new.id, title, '{}'::jsonb
    );
    ignored := ignored || 'disabled_at'::text;
  END IF;

  changes := inventory_private.audit_changes(pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new), ignored);
  IF changes <> '{}'::jsonb THEN
    PERFORM inventory_private.write_audit_log(
      actor, 'USER_UPDATED', 'user', new.id, title,
      pg_catalog.jsonb_build_object('changes', changes)
    );
  END IF;
  RETURN NULL;
END;
$function$;

-- Rollenberechtigungen: ROLE_PERMISSIONS_CHANGED mit dem neuen, sortierten Stand.
-- Rollenwechsel einzelner Benutzer (assign_role) erscheinen bereits als
-- USER_ROLE_CHANGED und werden hier ignoriert.
CREATE FUNCTION inventory_private.audit_role_permission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  granted jsonb;
BEGIN
  IF new.action IS DISTINCT FROM 'update_permissions' THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(rp.permission ORDER BY rp.permission), '[]'::jsonb)
    INTO granted
  FROM inventory_private.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  WHERE r.name = new.target_role;
  PERFORM inventory_private.write_audit_log(
    inventory_private.audit_actor(new.actor_id), 'ROLE_PERMISSIONS_CHANGED', 'role', NULL, new.target_role,
    pg_catalog.jsonb_build_object('role', new.target_role, 'permissions', granted)
  );
  RETURN NULL;
END;
$function$;

CREATE TRIGGER inventory_audit_devices
  AFTER INSERT OR UPDATE OR DELETE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION inventory_private.audit_device_change();

CREATE TRIGGER inventory_audit_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION inventory_private.audit_assignment_change();

CREATE TRIGGER inventory_audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION inventory_private.audit_profile_change();

DO $role_audit$
BEGIN
  IF pg_catalog.to_regclass('inventory_private.role_change_audit') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER inventory_audit_role_permissions
      AFTER INSERT ON inventory_private.role_change_audit
      FOR EACH ROW EXECUTE FUNCTION inventory_private.audit_role_permission_change()';
  ELSE
    RAISE NOTICE 'PBI-15: inventory_private.role_change_audit fehlt; Rollenberechtigungen werden nicht protokolliert.';
  END IF;
END;
$role_audit$;

-- ---------------------------------------------------------------------------
-- 6. Manipulationsschutz: Audit-Einträge sind unveränderlich
-- ---------------------------------------------------------------------------
CREATE FUNCTION inventory_private.audit_logs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF tg_op = 'UPDATE' THEN
    -- Einzige erlaubte Änderung: ON DELETE SET NULL des Fremdschlüssels user_id,
    -- nachdem das Profil tatsächlich gelöscht wurde. Alle anderen Felder bleiben gleich.
    IF old.user_id IS NOT NULL AND new.user_id IS NULL
       AND (pg_catalog.to_jsonb(new) - 'user_id') = (pg_catalog.to_jsonb(old) - 'user_id') THEN
      IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = old.user_id) THEN
        RETURN new;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'Audit-Einträge sind unveränderlich.',
    HINT = 'Audit-Einträge entstehen ausschließlich über Trigger und können weder geändert noch gelöscht werden.';
END;
$function$;

CREATE TRIGGER inventory_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION inventory_private.audit_logs_guard();

CREATE TRIGGER inventory_audit_logs_no_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_private.audit_logs_guard();

-- ---------------------------------------------------------------------------
-- 7. Leseberechtigung (FA-21): aktive Admin/SuperAdmin mit audit:view
-- ---------------------------------------------------------------------------
CREATE FUNCTION inventory_private.audit_require_reader()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  caller_role text;
BEGIN
  -- Sitzung und Kontostatus zuerst prüfen; inventory_my_permissions() erst danach.
  IF caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Anmeldung erforderlich.';
  END IF;
  IF NOT public.inventory_user_is_enabled() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Das Benutzerkonto ist deaktiviert.';
  END IF;
  IF NOT public.inventory_session_is_active() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Aktive Sitzung erforderlich.';
  END IF;

  SELECT r.name INTO caller_role
  FROM public.profiles p
  JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = caller AND p.disabled_at IS NULL;
  IF caller_role IS NULL OR caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Keine Berechtigung für das Audit-Log.';
  END IF;
  IF NOT coalesce('audit:view' = ANY (public.inventory_my_permissions()), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Keine Berechtigung für das Audit-Log.';
  END IF;
  RETURN caller;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. RPC: Audit-Log lesen (global oder pro Objekt), gefiltert und seitenweise
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.inventory_audit_log_list(
  target_page integer DEFAULT 0,
  target_action text DEFAULT NULL,
  target_entity_type text DEFAULT NULL,
  target_entity_id uuid DEFAULT NULL,
  search_text text DEFAULT NULL,
  created_from timestamptz DEFAULT NULL,
  created_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  page_size constant integer := 25;
  needle text;
  pattern text;
  output jsonb;
BEGIN
  PERFORM inventory_private.audit_require_reader();

  IF target_page IS NULL OR target_page < 0 OR target_page > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ungültige Seite.';
  END IF;
  IF target_action IS NOT NULL AND target_action <> ALL (ARRAY[
    'DEVICE_CREATED', 'DEVICE_UPDATED', 'DEVICE_STATUS_CHANGED', 'DEVICE_DELETED',
    'DEVICE_ASSIGNED', 'DEVICE_RETURNED', 'ASSIGNMENT_UPDATED', 'ASSIGNMENT_DELETED',
    'USER_CREATED', 'USER_UPDATED', 'USER_ROLE_CHANGED', 'USER_DISABLED', 'USER_ENABLED',
    'USER_DELETED', 'ROLE_PERMISSIONS_CHANGED'
  ]::text[]) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unbekannte Aktion.';
  END IF;
  IF target_entity_type IS NOT NULL AND target_entity_type NOT IN ('device', 'user', 'role') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unbekannter Objekttyp.';
  END IF;
  needle := nullif(pg_catalog.btrim(search_text, E' \t\r\n'), '');
  IF needle IS NOT NULL AND pg_catalog.char_length(needle) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Der Suchbegriff ist zu lang (maximal 100 Zeichen).';
  END IF;
  IF created_from IS NOT NULL AND created_to IS NOT NULL AND created_from > created_to THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Der Zeitraum ist ungültig.';
  END IF;

  IF needle IS NOT NULL THEN
    -- Platzhalter der Eingabe wörtlich suchen: \ % _ maskieren.
    pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
      needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT l.id, l.created_at, l.action, l.entity_type, l.entity_id, l.entity_title, l.user_id,
      CASE
        WHEN l.details IS NULL THEN '{}'::jsonb
        WHEN pg_catalog.jsonb_typeof(l.details) = 'object' THEN l.details
        ELSE pg_catalog.jsonb_build_object('value', l.details)
      END AS entry_details,
      coalesce(
        nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.first_name, p.last_name)), ''),
        u.email::text
      ) AS actor_name,
      u.email::text AS actor_email
    FROM public.audit_logs l
      LEFT JOIN public.profiles p ON p.id = l.user_id
      LEFT JOIN auth.users u ON u.id = l.user_id
    WHERE (target_action IS NULL OR l.action = target_action)
      AND (target_entity_type IS NULL OR l.entity_type = target_entity_type)
      AND (target_entity_id IS NULL OR l.entity_id = target_entity_id)
      AND (created_from IS NULL OR l.created_at >= created_from)
      AND (created_to IS NULL OR l.created_at <= created_to)
      AND (pattern IS NULL
        OR l.entity_title ILIKE pattern ESCAPE '\'
        OR pg_catalog.concat_ws(' ', p.first_name, p.last_name) ILIKE pattern ESCAPE '\'
        OR u.email::text ILIKE pattern ESCAPE '\'
        OR l.details ->> 'employee_name' ILIKE pattern ESCAPE '\'
        OR l.details ->> 'role' ILIKE pattern ESCAPE '\')
  )
  SELECT pg_catalog.jsonb_build_object(
    'total', (SELECT pg_catalog.count(*) FROM filtered),
    'page_size', page_size,
    'items', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', f.id::text,
          'created_at', f.created_at,
          'action', f.action,
          'entity_type', f.entity_type,
          'entity_id', f.entity_id::text,
          'entity_title', f.entity_title,
          'user_id', f.user_id::text,
          'user_name', f.actor_name,
          'user_email', f.actor_email,
          'details', f.entry_details
        ) ORDER BY f.created_at DESC, f.id DESC)
      FROM (
        SELECT * FROM filtered
        ORDER BY filtered.created_at DESC, filtered.id DESC
        LIMIT page_size OFFSET target_page * page_size
      ) f
    ), '[]'::jsonb)
  ) INTO output;
  RETURN output;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Ausführungsrechte: Hilfs- und Triggerfunktionen für niemanden, RPC nur
--    für angemeldete Benutzer (die Berechtigung prüft die Funktion selbst).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  inventory_private.audit_changes(jsonb, jsonb, text[]),
  inventory_private.try_uuid(text),
  inventory_private.audit_actor(uuid),
  inventory_private.profile_label(uuid),
  inventory_private.write_audit_log(uuid, text, text, uuid, text, jsonb),
  inventory_private.audit_device_change(),
  inventory_private.audit_assignment_change(),
  inventory_private.audit_profile_change(),
  inventory_private.audit_role_permission_change(),
  inventory_private.audit_logs_guard(),
  inventory_private.audit_require_reader(),
  public.inventory_audit_log_list(integer, text, text, uuid, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.inventory_audit_log_list(integer, text, text, uuid, text, timestamptz, timestamptz)
  TO authenticated;

COMMIT;
