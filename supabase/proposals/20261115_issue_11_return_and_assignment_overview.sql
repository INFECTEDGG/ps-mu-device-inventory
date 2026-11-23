-- Issues #10 und #11: Zuweisungsübersicht und sichere Geräterückgabe.
-- Entwurf für bestehende produktive Supabase-Datenbank. Nach Backup/Review manuell ausführen.
-- VORAUSSETZUNG: Issue #10 bereits installiert und erfolgreich getestet.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE col text;
BEGIN
  IF to_regprocedure('public.inventory_assign_device(uuid,uuid)') IS NULL
    OR to_regprocedure('public.inventory_assignment_candidates()') IS NULL
    OR to_regprocedure('public.inventory_my_permissions()') IS NULL
    OR to_regprocedure('public.inventory_user_is_enabled()') IS NULL
    OR to_regprocedure('public.inventory_session_is_active()') IS NULL THEN
    RAISE EXCEPTION 'Issue #11 requires the deployed assignment and authorization functions';
  END IF;
  IF to_regprocedure('public.inventory_assignments_overview(text,integer)') IS NOT NULL
    OR to_regprocedure('public.inventory_return_device(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Overview or return function already exists; inspect deployment before rerunning';
  END IF;
  IF to_regclass('public.devices') IS NULL
    OR to_regclass('public.assignments') IS NULL
    OR to_regclass('public.device_status_history') IS NULL THEN
    RAISE EXCEPTION 'Required device and assignment tables missing';
  END IF;
  FOREACH col IN ARRAY ARRAY['id','device_id','employee_id','assigned_by','assigned_at','returned_at','returned_by'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='assignments' AND column_name=col) THEN
      RAISE EXCEPTION 'Missing assignments.% (review schema first)', col;
    END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY['id','asset_tag','device_type','model','status'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='devices' AND column_name=col) THEN
      RAISE EXCEPTION 'Missing devices.%', col;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.assignments a JOIN public.devices d ON d.id=a.device_id
    WHERE a.returned_at IS NULL AND d.status IS DISTINCT FROM 'assigned'
  ) THEN RAISE EXCEPTION 'Active assignments with inconsistent status detected'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.assignments a JOIN public.devices d ON d.id=a.device_id
    WHERE a.returned_at IS NOT NULL AND d.status = 'assigned'
      AND NOT EXISTS (SELECT 1 FROM public.assignments active
                      WHERE active.device_id=a.device_id AND active.returned_at IS NULL)
  ) THEN RAISE EXCEPTION 'Assigned devices without active assignments detected'; END IF;
END;
$preflight$;

-- SECURITY DEFINER: never expose other employees' data to ordinary employees.
-- Total counts and pagination apply only to the visible assignment rows.
CREATE FUNCTION public.inventory_assignments_overview(
  target_state text DEFAULT 'active', target_page integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  caller_role text;
  may_see_all boolean := false;
  may_see_own boolean := false;
  output jsonb;
BEGIN
  IF caller IS NULL OR NOT public.inventory_user_is_enabled()
    OR NOT public.inventory_session_is_active() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active account/session required';
  END IF;
  IF target_state IS NULL OR target_state NOT IN ('active','returned')
    OR target_page IS NULL OR target_page < 0 OR target_page > 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid assignment filter or page';
  END IF;
  SELECT r.name INTO caller_role FROM public.profiles p
    JOIN public.roles r ON r.id=p.role_id WHERE p.id=caller AND p.disabled_at IS NULL;
  may_see_all := caller_role IN ('super_admin','admin','device_manager')
    AND ('assignments:view_all'=ANY(public.inventory_my_permissions()));
  may_see_own := ('assignments:view_own'=ANY(public.inventory_my_permissions()));
  IF NOT (coalesce(may_see_all,false) OR coalesce(may_see_own,false)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Assignment read permission required';
  END IF;

  WITH visible AS MATERIALIZED (
    SELECT a.id AS assignment_id, a.device_id,
      coalesce(d.asset_tag, '')::text AS asset_tag, coalesce(d.device_type, '')::text AS device_type,
      coalesce(d.model,'')::text AS model, a.employee_id,
      coalesce(nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ',ep.first_name,ep.last_name)),''),
               eu.email::text, 'Unbekannt') AS employee_name,
      coalesce(eu.email::text, '') AS employee_email,
      coalesce(nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ',issuer.first_name,issuer.last_name)),''),
               '–') AS assigned_by_name,
      CASE WHEN a.returned_by IS NULL THEN NULL
        ELSE coalesce(nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ',receiver.first_name,receiver.last_name)),''),
                      '–') END AS returned_by_name,
      a.assigned_at, a.returned_at
    FROM public.assignments a
      JOIN public.devices d ON d.id=a.device_id
      LEFT JOIN public.profiles ep ON ep.id=a.employee_id
      LEFT JOIN auth.users eu ON eu.id=a.employee_id
      LEFT JOIN public.profiles issuer ON issuer.id=a.assigned_by
      LEFT JOIN public.profiles receiver ON receiver.id=a.returned_by
    WHERE coalesce(may_see_all,false) OR a.employee_id=caller
  ), filtered AS (
    SELECT * FROM visible WHERE
      (target_state='active' AND returned_at IS NULL)
      OR (target_state='returned' AND returned_at IS NOT NULL)
  )
  SELECT pg_catalog.jsonb_build_object(
    'active_count', (SELECT count(*) FROM visible WHERE returned_at IS NULL),
    'returned_count', (SELECT count(*) FROM visible WHERE returned_at IS NOT NULL),
    'total', (SELECT count(*) FROM filtered),
    'items', coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)
                         ORDER BY r.assigned_at DESC, r.assignment_id DESC)
      FROM (SELECT * FROM filtered ORDER BY assigned_at DESC, assignment_id DESC
            LIMIT 10 OFFSET (target_page * 10)) r), '[]'::jsonb)
  ) INTO output;
  RETURN output;
END;
$function$;

-- Return transaction: same device-first lock order as assigning/changing status.
CREATE FUNCTION public.inventory_return_device(target_assignment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  caller_role text;
  target_device uuid;
  current_status text;
  active_assignment uuid;
  now_time timestamptz;
BEGIN
  IF caller IS NULL OR NOT public.inventory_user_is_enabled()
    OR NOT public.inventory_session_is_active() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active account/session required';
  END IF;
  SELECT r.name INTO caller_role FROM public.profiles p JOIN public.roles r ON r.id=p.role_id
    WHERE p.id=caller AND p.disabled_at IS NULL;
  IF caller_role IS NULL OR caller_role NOT IN ('super_admin','admin','device_manager')
    OR NOT ('assignments:manage'=ANY(public.inventory_my_permissions())) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Return permission required';
  END IF;
  IF target_assignment IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Assignment required';
  END IF;
  SELECT a.device_id INTO target_device FROM public.assignments a
    WHERE a.id=target_assignment;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Assignment not found';
  END IF;

  -- Lock the device first, then the assignment (same order as inventory_assign_device).
  SELECT d.status INTO current_status FROM public.devices d
    WHERE d.id=target_device FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Device not found';
  END IF;
  SELECT a.id INTO active_assignment FROM public.assignments a
    WHERE a.id=target_assignment AND a.device_id=target_device AND a.returned_at IS NULL FOR UPDATE;
  IF NOT FOUND OR current_status IS DISTINCT FROM 'assigned' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assignment no longer active or device status differs';
  END IF;

  now_time := pg_catalog.clock_timestamp();
  UPDATE public.assignments SET returned_at=now_time, returned_by=caller
    WHERE id=active_assignment AND returned_at IS NULL;
  UPDATE public.devices SET status='available' WHERE id=target_device;
  INSERT INTO public.device_status_history
    (id,device_id,old_status,new_status,changed_by,changed_at)
    VALUES (pg_catalog.gen_random_uuid(),target_device,'assigned','available',caller,now_time);
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_assignments_overview(text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.inventory_return_device(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_assignments_overview(text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_return_device(uuid) TO authenticated;
COMMIT;
