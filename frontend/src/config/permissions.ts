export type Role = 'super_admin' | 'admin' | 'device_manager' | 'employee'

export type Permission =
  | 'dashboard:view'
  | 'devices:view_own'
  | 'devices:view_all'
  | 'devices:manage'
  | 'assignments:view_own'
  | 'assignments:view_all'
  | 'assignments:manage'
  | 'users:manage'
  | 'roles:assign_basic'
  | 'roles:assign_admin'
  | 'roles:manage'
  | 'permissions:manage'
  | 'audit:view'
  | 'settings:view'

export const allPermissions: readonly Permission[] = [
  'dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
  'assignments:view_own', 'assignments:view_all', 'assignments:manage',
  'users:manage', 'roles:assign_basic', 'roles:assign_admin',
  'roles:manage', 'permissions:manage', 'audit:view', 'settings:view',
]

// Rechte, die der SuperAdmin über die Oberfläche ändern darf.
// Sensible Administrationsrechte bleiben fest und werden serverseitig geprüft.
export const editablePermissions: readonly Permission[] = [
  'dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
  'assignments:view_own', 'assignments:view_all', 'assignments:manage',
  'audit:view', 'settings:view',
]

export const permissionLabels: Record<Permission, string> = {
  'dashboard:view': 'Dashboard ansehen',
  'devices:view_own': 'Eigene Geräte ansehen',
  'devices:view_all': 'Alle Geräte ansehen',
  'devices:manage': 'Geräte verwalten',
  'assignments:view_own': 'Eigene Zuweisungen ansehen',
  'assignments:view_all': 'Alle Zuweisungen ansehen',
  'assignments:manage': 'Zuweisungen verwalten',
  'users:manage': 'Benutzer verwalten',
  'roles:assign_basic': 'Mitarbeiter/Gerätemanager zuweisen',
  'roles:assign_admin': 'Administratoren ernennen',
  'roles:manage': 'Rollen administrieren',
  'permissions:manage': 'Rollenberechtigungen ändern',
  'audit:view': 'Audit-Logs ansehen',
  'settings:view': 'Einstellungen ansehen',
}

export const rolePermissions: Record<Role, readonly Permission[]> = {
  super_admin: allPermissions,
  admin: [
    'dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
    'assignments:view_own', 'assignments:view_all', 'assignments:manage',
    'users:manage', 'roles:assign_basic', 'audit:view', 'settings:view',
  ],
  device_manager: [
    'dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
    'assignments:view_own', 'assignments:view_all', 'assignments:manage', 'settings:view',
  ],
  employee: ['dashboard:view', 'devices:view_own', 'assignments:view_own', 'settings:view'],
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (allPermissions as readonly string[]).includes(value)
}

// Zugewiesene DB-Berechtigungen haben Vorrang, sobald sie geladen sind.
// Ohne gueltige Rolle niemals Zugriff gewaehren.
export function hasPermission(
  role: Role | null | undefined,
  permission: Permission,
  grantedPermissions?: readonly Permission[] | null,
): boolean {
  if (!role) return false
  return (grantedPermissions ?? rolePermissions[role] ?? []).includes(permission)
}

export function canAssignRole(actor: Role | null, current: Role, target: Role, isSelf: boolean): boolean {
  if (isSelf || current === 'super_admin' || target === 'super_admin') return false
  if (actor === 'super_admin') return target !== current
  if (actor === 'admin') {
    return current !== 'admin' && target !== 'admin' && target !== current
  }
  return false
}
