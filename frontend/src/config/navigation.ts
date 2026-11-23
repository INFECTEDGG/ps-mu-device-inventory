
import type { IconName } from '../components/ui/AppIcon'
import { hasPermission, type Permission, type Role } from './permissions'

export interface NavigationEntry {
  description: string
  icon: IconName
  label: string
  path: string
  requiredPermission: Permission
  /**
   * Optional: nur diese Rollen dürfen den Bereich öffnen, auch wenn einer anderen
   * Rolle die Berechtigung zugewiesen wurde (Spiegel der serverseitigen Rollenprüfung).
   */
  allowedRoles?: readonly Role[]
}

/** Gemeinsame Regel für Menü (Sidebar) und Seitenzugriff (App). */
export function canOpenNavigationEntry(
  entry: NavigationEntry,
  role: Role | null | undefined,
  permissions?: readonly Permission[] | null,
): boolean {
  if (!role || !hasPermission(role, entry.requiredPermission, permissions)) return false
  return !entry.allowedRoles || entry.allowedRoles.includes(role)
}

export const navigationEntries: readonly NavigationEntry[] = [
  {
    label: 'Dashboard',
    path: '/',
    icon: 'dashboard',
    description: 'Kennzahlen und aktive Gerätezuweisungen auf einen Blick.',
    requiredPermission: 'dashboard:view',
  },
  {
    label: 'Geräte',
    path: '/geraete',
    icon: 'devices',
    description: 'Die Geräteverwaltung wird in einem separaten Arbeitspaket umgesetzt.',
    requiredPermission: 'devices:view_own',
  },
  {
    label: 'Zuweisungen',
    path: '/zuweisungen',
    icon: 'assignments',
    description: 'Gerätezuweisungen werden in einem separaten Arbeitspaket umgesetzt.',
    requiredPermission: 'assignments:view_own',
  },
  {
    label: 'Benutzerverwaltung',
    path: '/benutzerverwaltung',
    icon: 'users',
    description: 'Die Benutzerverwaltung wird in einem separaten Arbeitspaket umgesetzt.',
    requiredPermission: 'users:manage',
  },
  {
    label: 'Rollen & Berechtigungen',
    path: '/rollenverwaltung',
    icon: 'settings',
    description: 'Rollenberechtigungen zentral verwalten.',
    requiredPermission: 'permissions:manage',
  },
  {
    label: 'Audit-Log',
    path: '/audit-log',
    icon: 'audit',
    description: 'Protokollierte Änderungen an Geräten, Zuweisungen und Benutzern nachvollziehen.',
    requiredPermission: 'audit:view',
    // Wie serverseitig (inventory_audit_log_list): nur Administratoren und SuperAdmins.
    allowedRoles: ['admin', 'super_admin'],
  },
  {
    label: 'Einstellungen',
    path: '/einstellungen',
    icon: 'settings',
    description: 'Eigenes Konto, Passwort und Anzeigeoptionen verwalten.',
    requiredPermission: 'settings:view',
  },
]
