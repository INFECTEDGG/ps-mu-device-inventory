-- Nur Lesen! Vor der Installation ausführen, Ergebnisse kontrollieren.
SELECT
  to_regprocedure('public.inventory_assign_device(uuid,uuid)') AS assignment_rpc,
  to_regprocedure('public.inventory_assignments_overview(text,integer)') AS overview_rpc,
  to_regprocedure('public.inventory_return_device(uuid)') AS return_rpc,
  to_regprocedure('public.inventory_my_permissions()') AS rbac_rpc,
  to_regprocedure('public.inventory_session_is_active()') AS session_rpc;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('assignments','devices','device_status_history')
  AND column_name IN ('id','device_id','employee_id','assigned_by','assigned_at','returned_at',
                      'returned_by','status','old_status','new_status','changed_by','changed_at')
ORDER BY table_name, ordinal_position;

SELECT d.asset_tag, d.status, COUNT(a.id) FILTER (WHERE a.returned_at IS NULL) AS active_assignments
FROM public.devices d LEFT JOIN public.assignments a ON a.device_id=d.id
GROUP BY d.id, d.asset_tag, d.status ORDER BY d.asset_tag;

SELECT policyname, cmd, permissive, roles
FROM pg_policies WHERE schemaname='public' AND tablename IN ('devices','assignments')
ORDER BY tablename, policyname;
