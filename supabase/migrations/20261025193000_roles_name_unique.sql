
-- Device Inventory
-- Issue #5: Rollen und Berechtigungen verwalten
--
-- Ziel:
-- Doppelte Rollennamen verhindern.
--
-- Der UNIQUE-Constraint wurde am 25.10.2026
-- bereits in Supabase Production eingerichtet.
--
-- Voraussetzung:
-- Die Tabelle public.roles muss existieren.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.roles'::regclass
          AND conname = 'roles_name_unique'
    ) THEN

        ALTER TABLE public.roles
        ADD CONSTRAINT roles_name_unique UNIQUE (name);

    END IF;
END
$$;
