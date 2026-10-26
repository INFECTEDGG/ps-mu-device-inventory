export type Role = 'admin' | 'device_manager' | 'employee'

export type Permission =
  | 'dashboard:view'
  | 'devices:view_own'
  | 'devices:view_all'
  | 'devices:manage'
  | 'assignments:view_own'
  | 'assignments:view_all'
  | 'assignments:manage'
  | 'users:manage'
  | 'roles:manage'
  | 'audit:view'
  | 'settings:view'

// Entspricht Ümits Berechtigungsmodell auf origin/Uemit (e06907a).
export const rolePermissions: Record<Role, readonly Permission[]> = {
  admin: [
    'dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
    'assignments:view_own', 'assignments:view_all', 'assignments:manage',
    'users:manage', 'roles:manage', 'audit:view', 'settings:view',
  ],
  device_manager: [
    'dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
    'assignments:view_own', 'assignments:view_all', 'assignments:manage', 'settings:view',
  ],
  employee: ['dashboard:view', 'devices:view_own', 'assignments:view_own', 'settings:view'],
}

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  return role ? rolePermissions[role].includes(permission) : false
}
