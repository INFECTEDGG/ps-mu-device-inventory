
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '../config/permissions'

// Prüft, ob ein Rollenname zu unserem Rollenmodell gehört.
function isValidRole(value: unknown): value is Role {
  return (
    value === 'admin' ||
    value === 'device_manager' ||
    value === 'employee'
  )
}

// Lädt die Benutzerrolle aus der Supabase-Datenbank.
export async function loadUserRole(
  supabase: SupabaseClient,
  userId: string
): Promise<Role | null> {

  // 1. Benutzerprofil anhand der Benutzer-ID suchen
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role_id')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) {
    throw new Error(
      `Benutzerprofil konnte nicht geladen werden: ${profileError.message}`
    )
  }

  // Kein Profil oder keine Rolle vorhanden
  if (profile?.role_id == null) {
    return null
  }

  // 2. Den zugehörigen Rollennamen laden
  const { data: roleData, error: roleError } = await supabase
    .from('roles')
    .select('name')
    .eq('id', profile.role_id)
    .maybeSingle()

  if (roleError) {
    throw new Error(
      `Benutzerrolle konnte nicht geladen werden: ${roleError.message}`
    )
  }

  // 3. Nur bekannte Rollen akzeptieren
  if (!isValidRole(roleData?.name)) {
    return null
  }

  // 4. Gültige Rolle zurückgeben
  return roleData.name
}
