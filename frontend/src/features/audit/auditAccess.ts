import { hasPermission, type Permission, type Role } from '../../config/permissions'

/**
 * Frontend-Spiegel der Serverregel für das Audit-Log (FA-21): Zugriff hat, wer die
 * Berechtigung `audit:view` besitzt – standardmäßig Administratoren und SuperAdmins.
 * Weist der SuperAdmin `audit:view` einer weiteren Rolle zu, gilt das in Menü, Seite
 * und Server gleichermaßen (gleiche Regel wie `hasPermission` in Sidebar und App).
 */
export function mayViewAuditLog(
  role: Role | null | undefined,
  permissions?: readonly Permission[] | null,
): boolean {
  return hasPermission(role, 'audit:view', permissions)
}
