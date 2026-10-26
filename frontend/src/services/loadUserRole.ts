
import type { Role } from '../config/permissions'

// Schnittstelle für die Datenbankabfrage
export interface RoleLookupClient {
  getProfile(
    userId: string
  ): PromiseLike<{
    data: { role_id: unknown } | null
    error: unknown
  }>

  getRole(
    roleId: string | number
  ): PromiseLike<{
    data: { name: unknown } | null
    error: unknown
  }>
}

// Mögliche Fehler beim Laden der Benutzerrolle
type RoleErrorCode =
  | 'profile_missing'
  | 'role_missing'
  | 'unavailable'

const messages: Record<RoleErrorCode, string> = {
  profile_missing:
    'Für dein Konto fehlt noch das Benutzerprofil. Bitte wende dich an einen Administrator.',

  role_missing:
    'Deinem Konto ist keine gültige Rolle zugeordnet. Bitte wende dich an einen Administrator.',

  unavailable:
    'Deine Zugriffsberechtigungen konnten nicht geladen werden. Bitte versuche es erneut.',
}

// Spezielle Fehlerklasse für die Rollenverwaltung
export class UserRoleError extends Error {
  readonly code: RoleErrorCode

  constructor(code: RoleErrorCode) {
    super(messages[code])
    this.name = 'UserRoleError'
    this.code = code
  }
}

// Überprüft, ob der Rollenname gültig ist
function isValidRole(value: unknown): value is Role {
  return (
    value === 'admin' ||
    value === 'device_manager' ||
    value === 'employee'
  )
}

// Benutzerrolle anhand der Benutzer-ID laden
export async function loadUserRole(
  userId: string,
  client: RoleLookupClient | null
): Promise<Role> {

  // Ohne Benutzer-ID oder Client keine Berechtigungen
  if (!client || !userId) {
    throw new UserRoleError('unavailable')
  }

  try {
    // 1. Benutzerprofil aus Supabase laden
    const profile = await client.getProfile(userId)

    if (profile.error) {
      throw new UserRoleError('unavailable')
    }

    if (!profile.data) {
      throw new UserRoleError('profile_missing')
    }

    // 2. Rollen-ID überprüfen
    const roleId = profile.data.role_id

    const validId =
      (typeof roleId === 'number' &&
        Number.isSafeInteger(roleId) &&
        roleId > 0) ||
      (typeof roleId === 'string' &&
        /^[1-9]\d*$/.test(roleId))

    if (!validId) {
      throw new UserRoleError('role_missing')
    }

    // 3. Rollennamen aus der Datenbank laden
    const role = await client.getRole(roleId as string | number)

    if (role.error) {
      throw new UserRoleError('unavailable')
    }

    // 4. Nur gültige Benutzerrollen zulassen
    if (!isValidRole(role.data?.name)) {
      throw new UserRoleError('role_missing')
    }

    // 5. Gültige Rolle zurückgeben
    return role.data.name

  } catch (error) {
    if (error instanceof UserRoleError) {
      throw error
    }

    throw new UserRoleError('unavailable')
  }
}
