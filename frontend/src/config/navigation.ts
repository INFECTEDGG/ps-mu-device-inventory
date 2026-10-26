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
    requiredPermission: 'dashboard:view',
    icon: 'dashboard',
    description: 'Das Dashboard wird in einem separaten Arbeitspaket umgesetzt.',
  },
  {
    label: 'Geräte',
    path: '/geraete',
    requiredPermission: 'devices:view_own',
    icon: 'devices',
    description: 'Die Geräteverwaltung wird in einem separaten Arbeitspaket umgesetzt.',
  },
  {
    label: 'Zuweisungen',
    path: '/zuweisungen',
    requiredPermission: 'assignments:view_own',
    icon: 'assignments',
    description: 'Gerätezuweisungen werden in einem separaten Arbeitspaket umgesetzt.',
  },
  {
    label: 'Benutzerverwaltung',
    path: '/benutzerverwaltung',
    requiredPermission: 'users:manage',
    icon: 'users',
    description: 'Die Benutzerverwaltung wird in einem separaten Arbeitspaket umgesetzt.',
  },
  {
    label: 'Einstellungen',
    path: '/einstellungen',
    requiredPermission: 'settings:view',
    icon: 'settings',
    description: 'Einstellungen werden in einem separaten Arbeitspaket umgesetzt.',
  },
]
