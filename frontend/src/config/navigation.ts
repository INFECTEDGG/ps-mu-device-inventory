import type { IconName } from '../components/ui/AppIcon'

export interface NavigationEntry {
  description: string
  icon: IconName
  label: string
  path: string
}

export const navigationEntries: readonly NavigationEntry[] = [
  {
    label: 'Dashboard',
    path: '/',
    icon: 'dashboard',
    description: 'Das Dashboard wird in einem separaten Arbeitspaket umgesetzt.',
  },
  {
    label: 'Geräte',
    path: '/geraete',
    icon: 'devices',
    description: 'Die Geräteverwaltung wird in einem separaten Arbeitspaket umgesetzt.',
  },
  {
    label: 'Zuweisungen',
    path: '/zuweisungen',
    icon: 'assignments',
    description: 'Gerätezuweisungen werden in einem separaten Arbeitspaket umgesetzt.',
  },
  {
    label: 'Benutzerverwaltung',
    path: '/benutzerverwaltung',
    icon: 'users',
    description: 'Die Benutzerverwaltung wird in einem separaten Arbeitspaket umgesetzt.',
  },
  {
    label: 'Einstellungen',
    path: '/einstellungen',
    icon: 'settings',
    description: 'Einstellungen werden in einem separaten Arbeitspaket umgesetzt.',
  },
]
