import type { Role } from '../config/permissions'

export interface RoleLookupClient {
  getProfile(userId: string): PromiseLike<{ data: { role_id: unknown } | null; error: unknown }>
  getRole(roleId: string | number): PromiseLike<{ data: { name: unknown } | null; error: unknown }>
}

type RoleErrorCode = 'profile_missing' | 'role_missing' | 'unavailable'

const messages: Record<RoleErrorCode, string> = {
  profile_missing: 'Für dein Konto fehlt noch das Benutzerprofil. Bitte wende dich an einen Administrator.',
  role_missing: 'Deinem Konto ist keine gültige Rolle zugeordnet. Bitte wende dich an einen Administrator.',
  unavailable: 'Deine Zugriffsberechtigungen konnten nicht geladen werden. Bitte versuche es erneut.',
}

export class UserRoleError extends Error {
  readonly code: RoleErrorCode

  constructor(code: RoleErrorCode) {
    super(messages[code])
    this.code = code
  }
}

export async function loadUserRole(userId: string, client: RoleLookupClient | null): Promise<Role> {
  if (!client || !userId) throw new UserRoleError('unavailable')

  try {
    const profile = await client.getProfile(userId)
    if (profile.error) throw new UserRoleError('unavailable')
    if (!profile.data) throw new UserRoleError('profile_missing')

    const roleId = profile.data.role_id
    const validId = (typeof roleId === 'number' && Number.isSafeInteger(roleId) && roleId > 0)
      || (typeof roleId === 'string' && /^[1-9]\d*$/.test(roleId))
    if (!validId) throw new UserRoleError('role_missing')

    const role = await client.getRole(roleId as string | number)
    if (role.error) throw new UserRoleError('unavailable')
    const name = role.data?.name
    if (name !== 'admin' && name !== 'device_manager' && name !== 'employee') {
      throw new UserRoleError('role_missing')
    }

    return name
  } catch (error) {
    if (error instanceof UserRoleError) throw error
    throw new UserRoleError('unavailable')
  }
}
