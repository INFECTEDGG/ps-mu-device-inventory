-- Sicherheitskorrektur zu 20261028102000_superadmin_role_permissions.sql
--
-- VORSCHLAG: nach Review und Backup manuell im Supabase SQL Editor ausführen
-- (vor oder nach dem PBI-15-Proposal; unabhängig davon).
--
-- Fehler: public.inventory_admin_assign_role deklariert eine Variable mit dem
-- Namen current_role. In SQL-Ausdrücken ist CURRENT_ROLE jedoch ein Schlüsselwort
-- und liefert die aktuelle Datenbankrolle (bei SECURITY DEFINER den
-- Funktionsbesitzer, z. B. "postgres") – nicht die Rolle des Zielkontos.
-- Dadurch greifen die Prüfungen
--   * "SuperAdmin ist geschützt",
--   * "nur ein SuperAdmin ändert Administratoren" und
--   * "Rolle unverändert -> nichts tun"
-- nie. Ein normaler Administrator kann so den SuperAdmin oder andere
-- Administratoren zu Mitarbeitern/Gerätemanagern herabstufen (gefunden durch
-- supabase/tests/superAdminPermissions.test.mjs).
--
-- Korrektur: identische Funktion, nur die Variable heißt target_current_role.
-- Signatur, Fehlercodes, Meldungen und Rechte bleiben unverändert. Die Datei ist
-- idempotent und darf erneut ausgeführt werden.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.inventory_admin_assign_role(uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('inventory_private.require_user_admin()') IS NULL
     OR pg_catalog.to_regclass('inventory_private.sessions') IS NULL
     OR pg_catalog.to_regclass('inventory_private.role_change_audit') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Korrektur Rollenzuweisung: SuperAdmin-Proposal 20261028102000 ist nicht installiert.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'super_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Korrektur Rollenzuweisung: die Rolle super_admin fehlt.';
  END IF;
END;
$preflight$;

-- Rolle prüfen und atomar speichern; ALLE aktiven Sitzungen des Zielkontos widerrufen.
-- super_admin ist in der App nie zuweisbar oder änderbar; der erste Bootstrap ist manuell.
CREATE OR REPLACE FUNCTION public.inventory_admin_assign_role(target_id uuid, target_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid;
  caller_role text;
  target_current_role text;
  wanted_id bigint;
BEGIN
  caller := inventory_private.require_user_admin();
  SELECT r.name INTO caller_role
  FROM public.profiles p JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = caller;
  IF target_id IS NULL OR target_id = caller OR target_role IS NULL
     OR target_role NOT IN ('employee', 'device_manager', 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid role assignment';
  END IF;
  IF caller_role <> 'super_admin' AND target_role = 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only a SuperAdmin can appoint an administrator';
  END IF;
  SELECT r.name INTO target_current_role
  FROM public.profiles p JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = target_id AND p.disabled_at IS NULL
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Active user not found';
  END IF;
  IF target_current_role = 'super_admin'
     OR (caller_role <> 'super_admin' AND target_current_role = 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protected administrative account';
  END IF;
  IF target_current_role = target_role THEN
    RETURN;
  END IF;
  SELECT r.id INTO wanted_id FROM public.roles r WHERE r.name = target_role;
  IF wanted_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid role';
  END IF;
  UPDATE public.profiles SET role_id = wanted_id, updated_at = pg_catalog.now() WHERE id = target_id;
  UPDATE inventory_private.sessions SET revoked_at = coalesce(revoked_at, pg_catalog.now()) WHERE user_id = target_id;
  INSERT INTO inventory_private.role_change_audit (actor_id, target_user_id, target_role, action)
  VALUES (caller, target_id, target_role, 'assign_role');
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_admin_assign_role(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_admin_assign_role(uuid, text) TO authenticated;

COMMIT;
