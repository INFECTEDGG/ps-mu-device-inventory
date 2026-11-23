-- Ergaenzung zur bereits installierten aktiven Benutzerliste:
-- neue statusbasierte Listenfunktion fuer Admin und SuperAdmin.
-- Die vorhandene 2-Argument-Funktion bleibt unangetastet (Rueckwaertskompatibilitaet).
-- Deaktivierte Konten bleiben in der Datenbank erhalten.
-- Ausstehende Auth-Sperren erscheinen in der Ansicht "Deaktivierte Benutzer",
-- damit "Sperre abschliessen" weiterhin verfuegbar ist.
-- Nach 20261028114500_hide_deactivated_users_from_list.sql installieren.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.inventory_admin_list_users(integer,text)') IS NULL
     OR to_regprocedure('inventory_private.require_user_admin()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'super_admin') THEN
    RAISE EXCEPTION 'User management / SuperAdmin migrations must be installed first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inventory_admin_list_users(
  page_number integer,
  search_text text,
  list_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  PERFORM inventory_private.require_user_admin();
  IF page_number IS NULL OR page_number < 0 OR page_number > 100000
     OR search_text IS NULL OR length(search_text) > 100
     OR list_status IS NULL OR list_status NOT IN ('active','disabled') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Invalid list parameters';
  END IF;

  WITH matching AS (
    SELECT p.id, p.first_name, p.last_name, u.email, r.name AS role, p.disabled_at,
           coalesce(u.banned_until > pg_catalog.now(), false) AS login_blocked
    FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
      JOIN public.roles r ON r.id = p.role_id
    WHERE (
      (list_status = 'active' AND p.disabled_at IS NULL)
      OR (list_status = 'disabled' AND p.disabled_at IS NOT NULL)
    )
      AND (
        strpos(lower(concat_ws(' ', p.first_name, p.last_name, u.email, r.name)), lower(trim(search_text))) > 0
        OR trim(search_text) = ''
      )
  ), page AS (
    SELECT * FROM matching ORDER BY last_name NULLS LAST, first_name NULLS LAST, id
    LIMIT 25 OFFSET (page_number * 25)
  )
  SELECT jsonb_build_object(
    'users', coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM matching)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.inventory_admin_list_users(integer,text,text)
  FROM public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_admin_list_users(integer,text,text)
  TO authenticated;
COMMIT;
