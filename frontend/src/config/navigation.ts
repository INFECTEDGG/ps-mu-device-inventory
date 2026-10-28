
import type { IconName } from '../components/ui/AppIcon'
import type { Permission } from './permissions'

export interface NavigationEntry {
  description: string
  icon: IconName
  label: string
  path: string
  requiredPermission: Permission
}

export const navigationEntries: readonly NavigationEntry[] = [
  {
    label: 'Dashboard',
    path: '/',
    icon: 'dashboard',
    description: 'Das Dashboard wird in einem separaten Arbeitspaket umgesetzt.',
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
    label: 'Einstellungen',
    path: '/einstellungen',
    icon: 'settings',
    description: 'Einstellungen werden in einem separaten Arbeitspaket umgesetzt.',
    requiredPermission: 'settings:view',
  },
]
