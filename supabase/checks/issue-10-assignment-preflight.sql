-- Nur lesende Abfragen. Im Supabase SQL Editor jede SELECT-Anweisung einzeln
-- markieren, damit alle Ergebnisse sichtbar sind.
-- 1. Erwartete Tabellenfelder und Typen
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('assignments', 'devices', 'profiles', 'device_status_history')
  AND column_name IN ('id','device_id','employee_id','assigned_by','assigned_at',
    'returned_at','returned_by','created_at','status','role_id','disabled_at',
    'old_status','new_status','changed_by','changed_at')
ORDER BY table_name, ordinal_position;

-- 2. RLS-Policies auf den beiden relevanten Tabellen
SELECT tablename, policyname, cmd, permissive, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('devices','assignments')
ORDER BY tablename, policyname;

-- 3. Vorhandene aktive Zuweisungen und mögliche Inkonsistenzen
SELECT d.asset_tag, d.status, a.employee_id, a.assigned_at
FROM public.assignments a JOIN public.devices d ON d.id=a.device_id
WHERE a.returned_at IS NULL ORDER BY a.assigned_at DESC;

-- 4. Prüfen, ob die Funktion bereits existiert
SELECT to_regprocedure('public.inventory_assign_device(uuid,uuid)') AS assign_function,
       to_regprocedure('public.inventory_assignment_candidates()') AS candidates_function;
