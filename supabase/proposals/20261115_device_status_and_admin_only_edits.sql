-- Review proposal only. Run manually in Supabase SQL Editor after a backup.
-- Issue #7: ONLY admins/super_admins may edit device master data.
-- Issue #8: device_manager/admin/super_admin may change operational status.
-- Existing session, enabled-user and RBAC checks remain in force.
-- Never run against another environment without checking its schema/policies.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE needed text;
BEGIN
  IF to_regprocedure('public.inventory_my_permissions()') IS NULL
      OR to_regprocedure('public.inventory_session_is_active()') IS NULL
      OR to_regprocedure('public.inventory_user_is_enabled()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite session and RBAC functions are missing';
  END IF;
  IF to_regprocedure('public.inventory_device_set_status(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Status RPC already exists; review current deployment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices'
      AND policyname='devices_update_managed' AND cmd='UPDATE' AND permissive='PERMISSIVE'
  ) THEN RAISE EXCEPTION 'Expected existing devices_update_managed policy not found'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices'
      AND permissive='PERMISSIVE' AND cmd IN ('UPDATE','ALL')
      AND policyname <> 'devices_update_managed'
  ) THEN RAISE EXCEPTION 'Unexpected permissive update policy on devices'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices'
      AND policyname='inventory_active_session_guard' AND cmd='ALL' AND permissive='RESTRICTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices'
      AND policyname='inventory_enabled_user_guard' AND cmd='ALL' AND permissive='RESTRICTIVE'
  ) THEN RAISE EXCEPTION 'Expected protective policies on devices missing'; END IF;
  IF to_regclass('public.assignments') IS NULL OR to_regclass('public.device_status_history') IS NULL THEN
    RAISE EXCEPTION 'Assignments and device status history tables are required';
  END IF;
  -- Fail before making changes if actual column names differ from the UI.
  FOREACH needed IN ARRAY ARRAY[
    'id', 'status', 'asset_tag', 'device_type', 'manufacture', 'model',
    'serial_number', 'name', 'operating_system', 'processor', 'ram_gb',
    'disk_space_gb', 'location', 'device_usage', 'purchased_at',
    'start_of_use', 'maintenance_end', 'description', 'comments'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='devices' AND column_name=needed) THEN
      RAISE EXCEPTION 'Missing column devices.%', needed;
    END IF;
  END LOOP;
  FOREACH needed IN ARRAY ARRAY['id','device_id','old_status','new_status','changed_by','changed_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='device_status_history' AND column_name=needed) THEN
      RAISE EXCEPTION 'Missing column device_status_history.%', needed;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='devices' AND column_name='status' AND data_type='text') THEN
    RAISE EXCEPTION 'Review devices.status data type: this proposal expects text';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='device_status_history'
        AND column_name='id' AND data_type='uuid') THEN
    RAISE EXCEPTION 'Review device_status_history.id: this proposal expects UUID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.devices WHERE status IS NULL)
      AND EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='device_status_history'
          AND column_name='old_status' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'Some devices have NULL status, but history.old_status is NOT NULL. Review/backfill old devices first';
  END IF;

END;
$preflight$;

-- Preserve RLS but remove the overbroad update grant.
DROP POLICY devices_update_managed ON public.devices;
CREATE POLICY devices_update_admin_only ON public.devices
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id
      WHERE p.id=(SELECT auth.uid()) AND p.disabled_at IS NULL
        AND r.name IN ('admin','super_admin')
    )
    AND (SELECT 'devices:manage' = ANY(public.inventory_my_permissions()))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id
      WHERE p.id=(SELECT auth.uid()) AND p.disabled_at IS NULL
        AND r.name IN ('admin','super_admin')
    )
    AND (SELECT 'devices:manage' = ANY(public.inventory_my_permissions()))
  );

-- Block direct status writes, including for admins. Status changes must use the
-- validated RPC, which adds a history record in the SAME transaction.
REVOKE UPDATE ON public.devices FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  asset_tag, device_type, manufacture, model, serial_number, name,
  operating_system, processor, ram_gb, disk_space_gb, location, device_usage,
  purchased_at, start_of_use, maintenance_end, description, comments
) ON public.devices TO authenticated;

CREATE FUNCTION public.inventory_device_set_status(target_device uuid, target_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  caller_role text;
  old_status text;
BEGIN
  IF caller_id IS NULL OR NOT public.inventory_user_is_enabled()
      OR NOT public.inventory_session_is_active() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active account/session required';
  END IF;
  SELECT r.name INTO caller_role
    FROM public.profiles p JOIN public.roles r ON r.id=p.role_id
    WHERE p.id=caller_id AND p.disabled_at IS NULL;
  IF caller_role IS NULL OR caller_role NOT IN ('device_manager','admin','super_admin')
      OR NOT ('devices:manage' = ANY(public.inventory_my_permissions())) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Device status permission required';
  END IF;
  IF target_device IS NULL OR target_status IS NULL OR target_status NOT IN
      ('available','defective','maintenance','retired') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid status or device';
  END IF;
  IF target_status='retired' AND caller_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only administrators may retire devices';
  END IF;

  -- Lock the device first; future assignment/return transactions must use the
  -- same lock order to avoid status/assignment races.
  SELECT d.status INTO old_status FROM public.devices d
    WHERE d.id=target_device FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Device not found';
  END IF;
  IF old_status IS NOT DISTINCT FROM target_status THEN RETURN; END IF;
  IF old_status IN ('assigned','retired') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Device must be returned before changing status; retired is final';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.device_id=target_device AND a.returned_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Device has an active assignment';
  END IF;

  UPDATE public.devices SET status=target_status
    WHERE id=target_device;
  INSERT INTO public.device_status_history
    (id, device_id, old_status, new_status, changed_by, changed_at)
  VALUES
    (pg_catalog.gen_random_uuid(), target_device, old_status, target_status,
     caller_id, pg_catalog.clock_timestamp());
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_device_set_status(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_device_set_status(uuid,text) TO authenticated;
COMMIT;
