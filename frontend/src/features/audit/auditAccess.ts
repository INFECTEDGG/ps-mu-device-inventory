import { hasPermission, type Permission, type Role } from '../../config/permissions'

/**
 * Frontend-Spiegel der Serverregel für das Audit-Log (FA-21): nur Administratoren und
 * SuperAdmins mit der Berechtigung `audit:view`. Selbst wenn `audit:view` einer anderen
 * Rolle zugewiesen wird, verweigert der Server den Zugriff – die Oberfläche ebenfalls.
 */
export function mayViewAuditLog(
  role: Role | null | undefined,
  permissions?: readonly Permission[] | null,
): boolean {
  return (role === 'admin' || role === 'super_admin') && hasPermission(role, 'audit:view', permissions)
}
