-- Read-only schema and legacy data check. Safe to run BEFORE the proposal.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('devices','device_status_history','assignments')
  AND column_name IN (
    'id','status','device_id','old_status','new_status',
    'changed_by','changed_at','returned_at'
  )
ORDER BY table_name,column_name;

SELECT coalesce(status,'<NULL>') AS stored_status, count(*) AS device_count
FROM public.devices GROUP BY status ORDER BY stored_status;

SELECT count(*) AS active_assignments FROM public.assignments
WHERE returned_at IS NULL;

SELECT policyname,cmd,permissive FROM pg_policies
WHERE schemaname='public' AND tablename='devices'
ORDER BY policyname;
