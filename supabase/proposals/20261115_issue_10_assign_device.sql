-- Issue #10: Verfügbares Gerät einem aktiven Mitarbeiter zuweisen.
-- VORSCHLAG: nur nach Review, Backup und Preflight manuell im Supabase SQL Editor ausführen.
-- Diese DDL ändert produktive Berechtigungen. Keine direkte Zuweisung über den Browser!
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE required_col text;
BEGIN
  IF to_regprocedure('public.inventory_my_permissions()') IS NULL
     OR to_regprocedure('public.inventory_session_is_active()') IS NULL
     OR to_regprocedure('public.inventory_user_is_enabled()') IS NULL
     OR to_regprocedure('public.inventory_device_set_status(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Issue #10: RBAC-, Sitzungs- oder Statusfunktion fehlt. Zuerst Aufgabe 6 installieren.';
  END IF;
  IF to_regprocedure('public.inventory_assign_device(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.inventory_assignment_candidates()') IS NOT NULL THEN
    RAISE EXCEPTION 'Issue #10: Zuweisungsfunktionen sind bereits vorhanden; vorhandenen Stand zuerst prüfen.';
  END IF;
  IF to_regclass('public.devices') IS NULL
     OR to_regclass('public.assignments') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.device_status_history') IS NULL THEN
    RAISE EXCEPTION 'Issue #10: Erforderliche Anwendungstabellen fehlen.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid IN ('public.devices'::regclass,'public.assignments'::regclass)
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Issue #10: RLS muss für Geräte und Zuweisungen aktiviert sein.';
  END IF;
  FOREACH required_col IN ARRAY ARRAY['id','device_id','employee_id','assigned_by','assigned_at','returned_at','created_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='assignments' AND column_name=required_col) THEN
      RAISE EXCEPTION 'Issue #10: Spalte assignments.% fehlt.', required_col;
    END IF;
  END LOOP;
  FOREACH required_col IN ARRAY ARRAY['id','status','asset_tag'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='devices' AND column_name=required_col) THEN
      RAISE EXCEPTION 'Issue #10: Spalte devices.% fehlt.', required_col;
    END IF;
  END LOOP;
  FOREACH required_col IN ARRAY ARRAY['id','role_id','disabled_at','first_name','last_name'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='profiles' AND column_name=required_col) THEN
      RAISE EXCEPTION 'Issue #10: Spalte profiles.% fehlt.', required_col;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT device_id FROM public.assignments WHERE returned_at IS NULL
    GROUP BY device_id HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Issue #10: Geräte sind bereits mehrfach aktiv zugewiesen.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.assignments a JOIN public.devices d ON d.id=a.device_id
    WHERE a.returned_at IS NULL AND d.status IS DISTINCT FROM 'assigned'
  ) THEN RAISE EXCEPTION 'Issue #10: Bestehende Zuweisungen und Gerätestatus widersprechen sich.'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='assignments'
    AND policyname IN ('inventory_assignment_read_allow', 'inventory_assignment_read_limit')) THEN
    RAISE EXCEPTION 'Issue #10: Zuweisungs-Lese-Policy existiert bereits. Bitte vergleichen.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices'
    AND policyname = 'inventory_device_select_assigned_own') THEN
    RAISE EXCEPTION 'Issue #10: Eigen-Geräte-Policy existiert bereits. Bitte vergleichen.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='assignments'
    AND indexname='inventory_assignments_one_active_device') THEN
    RAISE EXCEPTION 'Issue #10: Eindeutigkeitsindex existiert bereits. Bitte Definition vergleichen.';
  END IF;
END;
$preflight$;

-- Physische DB-Garantie: Pro Gerät höchstens eine aktive Zuweisung.
CREATE UNIQUE INDEX inventory_assignments_one_active_device
  ON public.assignments(device_id) WHERE returned_at IS NULL;

-- Browser darf keine Zuweisungen direkt schreiben; nur der geprüfte RPC.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.assignments FROM PUBLIC, anon, authenticated;
-- Nur die benötigten Lesespalten, weiterhin durch RLS geschützt.
GRANT SELECT(id,device_id,employee_id,assigned_by,assigned_at,returned_at,created_at)
  ON TABLE public.assignments TO authenticated;

-- Enge Lesegrenze auch dann, wenn andere permissive SELECT-Policies existieren.
CREATE POLICY inventory_assignment_read_allow ON public.assignments
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_assignment_read_limit ON public.assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (employee_id=(SELECT auth.uid())
      AND (SELECT 'assignments:view_own'=ANY(public.inventory_my_permissions())))
    OR
    ((SELECT 'assignments:view_all'=ANY(public.inventory_my_permissions()))
      AND EXISTS (
        SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id
        WHERE p.id=(SELECT auth.uid()) AND p.disabled_at IS NULL
          AND r.name IN ('admin','super_admin','device_manager')
      ))
  );

-- Mitarbeitende dürfen nur Geräte mit eigener aktiver Zuweisung sehen.
CREATE POLICY inventory_device_select_assigned_own ON public.devices
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (SELECT 'devices:view_own'=ANY(public.inventory_my_permissions()))
    AND EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.device_id=devices.id AND a.employee_id=(SELECT auth.uid())
        AND a.returned_at IS NULL
    )
  );

-- Datenschutz: Mitarbeiterliste nur für Personen mit Zuweisungsberechtigung.
CREATE FUNCTION public.inventory_assignment_candidates()
RETURNS TABLE(user_id uuid, display_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller_role text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.inventory_user_is_enabled()
     OR NOT public.inventory_session_is_active() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active account/session required';
  END IF;
  SELECT r.name INTO caller_role FROM public.profiles p
    JOIN public.roles r ON r.id=p.role_id
    WHERE p.id=auth.uid() AND p.disabled_at IS NULL;
  IF caller_role IS NULL OR caller_role NOT IN ('admin','super_admin','device_manager')
     OR NOT ('assignments:manage'=ANY(public.inventory_my_permissions())) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Assignment permission required';
  END IF;
  RETURN QUERY SELECT p.id,
    COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ',p.first_name,p.last_name)),''), u.email),
    u.email::text
  FROM public.profiles p
    JOIN public.roles r ON r.id=p.role_id
    JOIN auth.users u ON u.id=p.id
  WHERE r.name='employee' AND p.disabled_at IS NULL
    AND u.email IS NOT NULL
    AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.now())
  ORDER BY p.last_name NULLS LAST, p.first_name NULLS LAST, u.email;
END;
$function$;

-- Eine Transaktion: prüfen -> Gerät sperren -> Zuweisung anlegen -> Status
-- ändern -> Historie eintragen. Fehlschlag = kompletter Rollback.
CREATE FUNCTION public.inventory_assign_device(target_device uuid, target_employee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller_id uuid := auth.uid(); caller_role text; prior_status text;
BEGIN
  IF caller_id IS NULL OR NOT public.inventory_user_is_enabled()
     OR NOT public.inventory_session_is_active() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active account/session required';
  END IF;
  SELECT r.name INTO caller_role FROM public.profiles p
    JOIN public.roles r ON r.id=p.role_id
    WHERE p.id=caller_id AND p.disabled_at IS NULL;
  IF caller_role IS NULL OR caller_role NOT IN ('admin','super_admin','device_manager')
     OR NOT ('assignments:manage'=ANY(public.inventory_my_permissions())) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Assignment permission required';
  END IF;
  IF target_device IS NULL OR target_employee IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Device and employee required';
  END IF;

  -- Sperr-Reihenfolge identisch mit inventory_device_set_status: Gerät zuerst.
  SELECT d.status INTO prior_status FROM public.devices d
    WHERE d.id=target_device FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Device not found';
  END IF;
  IF prior_status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Only available devices can be assigned';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assignments a
    WHERE a.device_id=target_device AND a.returned_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Device already assigned';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
      JOIN public.roles r ON r.id=p.role_id
      JOIN auth.users u ON u.id=p.id
    WHERE p.id=target_employee AND p.disabled_at IS NULL
      AND r.name='employee'
      AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.now())
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Active employee not found';
  END IF;

  INSERT INTO public.assignments(id,device_id,employee_id,assigned_by,assigned_at,created_at)
  VALUES(pg_catalog.gen_random_uuid(),target_device,target_employee,caller_id,
         pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp());
  UPDATE public.devices SET status='assigned' WHERE id=target_device;
  INSERT INTO public.device_status_history
    (id,device_id,old_status,new_status,changed_by,changed_at)
  VALUES(pg_catalog.gen_random_uuid(),target_device,prior_status,'assigned',caller_id,
         pg_catalog.clock_timestamp());
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_assignment_candidates() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.inventory_assign_device(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_assignment_candidates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_assign_device(uuid,uuid) TO authenticated;
COMMIT;
