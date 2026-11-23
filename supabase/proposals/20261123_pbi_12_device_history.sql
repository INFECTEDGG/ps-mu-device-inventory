-- PBI-12: Geräte- und Zuweisungshistorie anzeigen (FA-14)
--
-- VORSCHLAG: nur nach Review und Backup manuell im Supabase SQL Editor ausführen.
-- Reihenfolge:
--   1. supabase/checks/pbi-12-device-history-preflight.sql lesend ausführen und prüfen.
--   2. Diese Datei VOLLSTÄNDIG ausführen (eine Transaktion; bei einem Fehler wird
--      nichts geändert). Empfohlen nach 20261123_pbi_15_audit_log.sql; technisch
--      ist dieses Proposal davon unabhängig.
-- Voraussetzungen: Gerätestatus (Issue #8), Zuweisung (Issue #10) und Rücknahme
-- (Issue #11) sowie Sitzungs- und RBAC-Funktionen sind installiert.
--
-- Ergebnis:
-- * Historische Daten bleiben erhalten: abgeschlossene Zuweisungen und Einträge
--   der Statushistorie können weder geändert noch gelöscht werden – auch nicht
--   per Superuser-UPDATE/DELETE/TRUNCATE. Erlaubt bleibt nur das automatische
--   Nullsetzen eines Benutzerbezugs (ON DELETE SET NULL), wenn das Profil gelöscht
--   wurde. Aktive Zuweisungen bleiben für die Rücknahme änderbar.
-- * public.inventory_device_history(uuid) liefert Gerät, Zuweisungen und
--   Statusänderungen für Gerätemanager, Administratoren und SuperAdmins mit
--   devices:view_all UND assignments:view_all.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  needed text;
BEGIN
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('public.inventory_user_is_enabled()') IS NULL
     OR pg_catalog.to_regprocedure('public.inventory_session_is_active()') IS NULL
     OR pg_catalog.to_regprocedure('public.inventory_my_permissions()') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-12: auth.uid() oder die Sitzungs-/RBAC-Funktionen fehlen.',
      HINT = 'Zuerst Server-Sitzung, Benutzerverwaltung und SuperAdmin-Berechtigungen installieren.';
  END IF;
  IF pg_catalog.to_regprocedure('public.inventory_device_set_status(uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.inventory_assign_device(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.inventory_return_device(uuid)') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-12: Status-, Zuweisungs- oder Rücknahmefunktion fehlt.',
      HINT = 'Zuerst die Proposals für Issue #8, #10 und #11 installieren.';
  END IF;
  IF pg_catalog.to_regnamespace('inventory_private') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-12: das private Schema inventory_private fehlt.';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-12: die Supabase-Rollen anon, authenticated und service_role werden benötigt.';
  END IF;

  FOREACH needed IN ARRAY ARRAY['devices', 'assignments', 'device_status_history', 'profiles', 'roles'] LOOP
    IF pg_catalog.to_regclass('public.' || needed) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-12: die Tabelle public.%s fehlt.', needed);
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['id', 'device_id', 'employee_id', 'assigned_by', 'assigned_at', 'returned_at', 'returned_by'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'assignments' AND column_name = needed) THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-12: die Spalte assignments.%s fehlt.', needed);
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['id', 'device_id', 'old_status', 'new_status', 'changed_by', 'changed_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'device_status_history' AND column_name = needed) THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-12: die Spalte device_status_history.%s fehlt.', needed);
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['id', 'asset_tag', 'name', 'device_type', 'manufacture', 'model', 'status'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = needed) THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-12: die Spalte devices.%s fehlt.', needed);
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['id', 'role_id', 'first_name', 'last_name', 'disabled_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = needed) THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = pg_catalog.format('PBI-12: die Spalte profiles.%s fehlt.', needed);
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('public.inventory_device_history(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-12: public.inventory_device_history existiert bereits – das Proposal wurde offenbar schon ausgeführt.',
      HINT = 'Installierten Stand mit supabase/checks/pbi-12-device-history-preflight.sql prüfen; nichts wurde geändert.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.pronamespace = 'inventory_private'::regnamespace
      AND p.proname IN ('preserve_assignment_history', 'preserve_status_history')) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PBI-12: Schutzfunktionen mit den vorgesehenen Namen existieren bereits in inventory_private.';
  END IF;

  -- Während der Installation keine Zuweisungen oder Statusänderungen zulassen.
  LOCK TABLE public.assignments, public.device_status_history IN SHARE ROW EXCLUSIVE MODE;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Kein direkter Schreibzugriff aus dem Browser (erneut, idempotent).
--    Statuswechsel, Zuweisung und Rücknahme laufen nur über die geprüften RPCs.
--    SELECT-Rechte bleiben unverändert.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.device_status_history
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.assignments
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Indizes für die Historie eines Gerätes (neueste zuerst)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS device_status_history_device_changed_idx
  ON public.device_status_history (device_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS assignments_device_assigned_idx
  ON public.assignments (device_id, assigned_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Historische Daten bleiben erhalten
-- ---------------------------------------------------------------------------

-- Zuweisungen: aktive Zuweisungen dürfen geändert werden (Rücknahme), abgeschlossene
-- nicht. Löschen ist nie erlaubt.
CREATE FUNCTION inventory_private.preserve_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  old_row jsonb;
  changed record;
BEGIN
  IF tg_op <> 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Zuweisungen bleiben für die Gerätehistorie erhalten.',
      HINT = 'Zuweisungen werden über die Rücknahme abgeschlossen, nicht gelöscht.';
  END IF;

  IF old.returned_at IS NULL THEN
    RETURN new;
  END IF;

  -- Abgeschlossen: nur ON DELETE SET NULL eines Benutzerbezugs, dessen Profil
  -- tatsächlich gelöscht wurde.
  old_row := pg_catalog.to_jsonb(old);
  FOR changed IN
    SELECT c.key, c.value
    FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(new)) AS c
    WHERE c.value IS DISTINCT FROM old_row -> c.key
  LOOP
    IF changed.key NOT IN ('employee_id', 'assigned_by', 'returned_by')
       OR pg_catalog.jsonb_typeof(changed.value) <> 'null' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Abgeschlossene Zuweisungen sind unveränderlich.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (old_row ->> changed.key)::uuid) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Abgeschlossene Zuweisungen sind unveränderlich.';
    END IF;
  END LOOP;
  RETURN new;
END;
$function$;

-- Statushistorie: Einträge sind unveränderlich; nur ON DELETE SET NULL von
-- changed_by nach dem Löschen des Profils ist erlaubt.
CREATE FUNCTION inventory_private.preserve_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF tg_op = 'UPDATE' THEN
    IF old.changed_by IS NOT NULL AND new.changed_by IS NULL
       AND (pg_catalog.to_jsonb(new) - 'changed_by') = (pg_catalog.to_jsonb(old) - 'changed_by') THEN
      IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = old.changed_by) THEN
        RETURN new;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'Die Statushistorie ist unveränderlich.',
    HINT = 'Statusänderungen werden ausschließlich über die Status-, Zuweisungs- und Rücknahmefunktionen protokolliert.';
END;
$function$;

CREATE TRIGGER inventory_assignments_preserve_history
  BEFORE UPDATE OR DELETE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION inventory_private.preserve_assignment_history();

CREATE TRIGGER inventory_assignments_no_truncate
  BEFORE TRUNCATE ON public.assignments
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_private.preserve_assignment_history();

CREATE TRIGGER inventory_status_history_preserve
  BEFORE UPDATE OR DELETE ON public.device_status_history
  FOR EACH ROW EXECUTE FUNCTION inventory_private.preserve_status_history();

CREATE TRIGGER inventory_status_history_no_truncate
  BEFORE TRUNCATE ON public.device_status_history
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_private.preserve_status_history();

-- ---------------------------------------------------------------------------
-- 4. RPC: Historie eines Gerätes
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.inventory_device_history(target_device uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  caller_role text;
  granted text[];
  device_json jsonb;
  output jsonb;
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
  IF caller_role IS NULL OR caller_role NOT IN ('device_manager', 'admin', 'super_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Keine Berechtigung für die Gerätehistorie.';
  END IF;
  granted := public.inventory_my_permissions();
  IF NOT coalesce('devices:view_all' = ANY (granted), false)
     OR NOT coalesce('assignments:view_all' = ANY (granted), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Keine Berechtigung für die Gerätehistorie.';
  END IF;

  IF target_device IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Gerät fehlt.';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
      'id', d.id::text,
      'asset_tag', d.asset_tag,
      'name', d.name,
      'device_type', d.device_type,
      'manufacture', d.manufacture,
      'model', d.model,
      'status', d.status
    )
    INTO device_json
  FROM public.devices d
  WHERE d.id = target_device;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Gerät nicht gefunden.';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'device', device_json,
    'assignments', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'assignment_id', h.id::text,
          'employee_id', h.employee_id::text,
          'employee_name', coalesce(
            nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', ep.first_name, ep.last_name)), ''),
            eu.email::text, 'Unbekannt'),
          'employee_email', coalesce(eu.email::text, ''),
          'assigned_at', h.assigned_at,
          'assigned_by_name', CASE WHEN h.assigned_by IS NULL THEN NULL ELSE coalesce(
            nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', ip.first_name, ip.last_name)), ''),
            iu.email::text, 'Unbekannt') END,
          'returned_at', h.returned_at,
          'returned_by_name', CASE WHEN h.returned_at IS NULL OR h.returned_by IS NULL THEN NULL ELSE coalesce(
            nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', rp.first_name, rp.last_name)), ''),
            ru.email::text, 'Unbekannt') END,
          'active', h.returned_at IS NULL
        ) ORDER BY h.assigned_at DESC, h.id DESC)
      FROM (
        SELECT a.id, a.employee_id, a.assigned_by, a.assigned_at, a.returned_at, a.returned_by
        FROM public.assignments a
        WHERE a.device_id = target_device
        ORDER BY a.assigned_at DESC, a.id DESC
        LIMIT 200
      ) h
        LEFT JOIN public.profiles ep ON ep.id = h.employee_id
        LEFT JOIN auth.users eu ON eu.id = h.employee_id
        LEFT JOIN public.profiles ip ON ip.id = h.assigned_by
        LEFT JOIN auth.users iu ON iu.id = h.assigned_by
        LEFT JOIN public.profiles rp ON rp.id = h.returned_by
        LEFT JOIN auth.users ru ON ru.id = h.returned_by
    ), '[]'::jsonb),
    'assignments_total', (
      SELECT pg_catalog.count(*) FROM public.assignments a WHERE a.device_id = target_device
    ),
    'status_changes', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', s.id::text,
          'old_status', s.old_status,
          'new_status', s.new_status,
          'changed_at', s.changed_at,
          'changed_by_name', CASE WHEN s.changed_by IS NULL THEN NULL ELSE coalesce(
            nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', cp.first_name, cp.last_name)), ''),
            cu.email::text, 'Unbekannt') END
        ) ORDER BY s.changed_at DESC, s.id DESC)
      FROM (
        SELECT h.id, h.old_status, h.new_status, h.changed_at, h.changed_by
        FROM public.device_status_history h
        WHERE h.device_id = target_device
        ORDER BY h.changed_at DESC, h.id DESC
        LIMIT 200
      ) s
        LEFT JOIN public.profiles cp ON cp.id = s.changed_by
        LEFT JOIN auth.users cu ON cu.id = s.changed_by
    ), '[]'::jsonb),
    'status_changes_total', (
      SELECT pg_catalog.count(*) FROM public.device_status_history h WHERE h.device_id = target_device
    )
  ) INTO output;
  RETURN output;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Ausführungsrechte
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  inventory_private.preserve_assignment_history(),
  inventory_private.preserve_status_history(),
  public.inventory_device_history(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_device_history(uuid) TO authenticated;

COMMIT;
