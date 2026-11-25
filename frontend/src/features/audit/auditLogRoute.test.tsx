// @vitest-environment jsdom

// PBI-15: Einbindung des Audit-Logs in Menü und Routing (FA-21).
// Geprüft wird das Zusammenspiel mit der bestehenden App-Logik, ohne diese zu verändern:
// Menüpunkt und Seitenzugriff folgen der Berechtigung `audit:view`.

import { createElement, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { navigationEntries } from '../../config/navigation'
import { hasPermission, type Permission, type Role } from '../../config/permissions'
import { useAppNavigation } from '../../hooks/useAppNavigation'
import { useAuthSession } from '../../hooks/useAuthSession'
import App from '../../App'
import { mayViewAuditLog } from './auditAccess'

vi.mock('../../hooks/useAppNavigation', () => ({
  useAppNavigation: vi.fn(),
}))

// Keine Verbindung zur echten Supabase-Datenbank.
vi.mock('../../hooks/useAuthSession', () => ({
  useAuthSession: vi.fn(),
}))

vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))

// Die Seite selbst wird in AuditLogPage.test.tsx geprüft; hier nur die Route.
vi.mock('./AuditLogPage', () => ({
  AuditLogPage: () => <div>Audit-Log-Inhalt</div>,
}))

vi.mock('../../components/ui/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

const roles: readonly Role[] = ['super_admin', 'admin', 'device_manager', 'employee']

function setCurrentPath(path: string) {
  vi.mocked(useAppNavigation).mockReturnValue({ currentPath: path, navigate: vi.fn() })
}

function setAuthState(role: Role, permissions: readonly Permission[] | null = null) {
  const session = { user: { id: 'test-user' } } as Session
  vi.mocked(useAuthSession).mockReturnValue({
    session,
    user: session.user,
    userId: session.user.id,
    role,
    permissions,
    isLoading: false,
    isRoleLoading: false,
    isSigningOut: false,
    profileError: null,
    sessionNotice: null,
    clearSessionNotice: vi.fn(),
    reloadProfile: vi.fn(),
  })
}

/** Gleiche Filterregel wie die Sidebar: Menüpunkte nach `hasPermission`. */
function menuLabels(role: Role, permissions: readonly Permission[] | null = null): string[] {
  return navigationEntries
    .filter((entry) => hasPermission(role, entry.requiredPermission, permissions))
    .map((entry) => entry.label)
}

describe('Audit-Log – Menüpunkt (FA-21)', () => {
  it('steht direkt vor den Einstellungen und verlangt audit:view', () => {
    const labels = navigationEntries.map((entry) => entry.label)
    const audit = navigationEntries.find((entry) => entry.path === '/audit-log')

    expect(audit).toMatchObject({ label: 'Audit-Log', icon: 'layout', requiredPermission: 'audit:view' })
    expect(labels.indexOf('Audit-Log')).toBe(labels.indexOf('Einstellungen') - 1)
  })

  it('erscheint standardmäßig nur für Administratoren und SuperAdmins', () => {
    expect(menuLabels('super_admin')).toContain('Audit-Log')
    expect(menuLabels('admin')).toContain('Audit-Log')
    expect(menuLabels('device_manager')).not.toContain('Audit-Log')
    expect(menuLabels('employee')).not.toContain('Audit-Log')
  })

  it('folgt den vom SuperAdmin vergebenen Berechtigungen', () => {
    expect(menuLabels('device_manager', ['dashboard:view', 'audit:view'])).toContain('Audit-Log')
    expect(menuLabels('admin', ['dashboard:view', 'settings:view'])).not.toContain('Audit-Log')
  })

  it.each(roles)('Menü und Seitenregel stimmen für %s überein', (role) => {
    for (const permissions of [null, ['audit:view'], ['dashboard:view']] as const) {
      expect(menuLabels(role, permissions).includes('Audit-Log')).toBe(mayViewAuditLog(role, permissions))
    }
  })
})

describe('Audit-Log – Route /audit-log (FA-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    setCurrentPath('/audit-log')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each(['admin', 'super_admin'] as const)('%s öffnet das Audit-Log', (role) => {
    setAuthState(role)
    render(<App />)

    expect(screen.getByText('Audit-Log-Inhalt')).toBeTruthy()
    expect(document.title).toBe('Audit-Log | Device Inventory')
  })

  it.each(['device_manager', 'employee'] as const)('%s erhält standardmäßig keinen Zugriff', (role) => {
    setAuthState(role)
    render(<App />)

    expect(screen.getByText('Zugriff verweigert')).toBeTruthy()
    expect(screen.queryByText('Audit-Log-Inhalt')).toBeNull()
  })

  it('Gerätemanager mit zugewiesenem audit:view öffnet das Audit-Log', () => {
    setAuthState('device_manager', ['dashboard:view', 'audit:view'])
    render(<App />)

    expect(screen.getByText('Audit-Log-Inhalt')).toBeTruthy()
  })

  it('Administrator ohne audit:view erhält keinen Zugriff', () => {
    setAuthState('admin', ['dashboard:view', 'users:manage', 'settings:view'])
    render(<App />)

    expect(screen.getByText('Zugriff verweigert')).toBeTruthy()
    expect(screen.queryByText('Audit-Log-Inhalt')).toBeNull()
  })
})
