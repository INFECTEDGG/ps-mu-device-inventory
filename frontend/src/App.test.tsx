
 // @vitest-environment jsdom

import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Role } from './config/permissions'
import { useAppNavigation } from './hooks/useAppNavigation'
import { useAuthSession } from './hooks/useAuthSession'
import App from './App'

// Navigation simulieren
vi.mock('./hooks/useAppNavigation', () => ({
  useAppNavigation: vi.fn(),
}))

// Authentifizierung und Benutzerrolle simulieren.
// Keine Verbindung zur echten Supabase-Datenbank.
vi.mock('./hooks/useAuthSession', () => ({
  useAuthSession: vi.fn(),
}))

// Layout isolieren
vi.mock('./components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('./pages/PlaceholderPage', () => ({
  PlaceholderPage: () => (
    <div>Geschützter Seiteninhalt</div>
  ),
}))

vi.mock('./pages/NotFoundPage', () => ({
  NotFoundPage: () => <div>Seite nicht gefunden</div>,
}))

vi.mock('./pages/LoginPage', () => ({
  LoginPage: () => <div>Login angezeigt</div>,
}))

vi.mock('./components/ui/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => (
    <h1>{title}</h1>
  ),
}))

function setCurrentPath(path: string) {
  vi.mocked(useAppNavigation).mockReturnValue({
    currentPath: path,
    navigate: vi.fn(),
  })
}

// Gemeinsamen AuthProvider-Zustand simulieren
function setAuthState(role: Role | null, signedIn = true) {
  const session = signedIn
    ? ({
        user: { id: 'test-user' },
      } as Session)
    : null

  vi.mocked(useAuthSession).mockReturnValue({
    session,
    user: session?.user ?? null,
    userId: session?.user.id ?? null,
    role: signedIn ? role : null,
    isLoading: false,
    isRoleLoading: false,
    isSigningOut: false,
    profileError: null,
    sessionNotice: null,
    clearSessionNotice: vi.fn(),
    reloadProfile: vi.fn(),
  })
}

describe('RBAC - Seitenzugriff nach Benutzerrolle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('Admin darf Benutzerverwaltung öffnen', () => {
    setCurrentPath('/benutzerverwaltung')
    setAuthState('admin')

    render(<App />)

    expect(
      screen.getByText('Geschützter Seiteninhalt')
    ).toBeTruthy()
  })

  it('Mitarbeiter darf Benutzerverwaltung nicht öffnen', () => {
    setCurrentPath('/benutzerverwaltung')
    setAuthState('employee')

    render(<App />)

    expect(
      screen.getByText('Zugriff verweigert')
    ).toBeTruthy()

    expect(
      screen.queryByText('Geschützter Seiteninhalt')
    ).toBeNull()
  })

  it('Gerätemanager darf Benutzerverwaltung nicht öffnen', () => {
    setCurrentPath('/benutzerverwaltung')
    setAuthState('device_manager')

    render(<App />)

    expect(
      screen.getByText('Zugriff verweigert')
    ).toBeTruthy()

    expect(
      screen.queryByText('Geschützter Seiteninhalt')
    ).toBeNull()
  })

  it('Benutzer ohne gültige Rolle erhält keinen Zugriff', () => {
    setCurrentPath('/geraete')
    setAuthState(null)

    render(<App />)

    expect(
      screen.getByText('Zugriff verweigert')
    ).toBeTruthy()

    expect(
      screen.queryByText('Geschützter Seiteninhalt')
    ).toBeNull()
  })

  it('Benutzer ohne Anmeldung sieht nur den Login', () => {
    setCurrentPath('/benutzerverwaltung')
    setAuthState(null, false)

    render(<App />)

    expect(
      screen.getByText('Login angezeigt')
    ).toBeTruthy()

    expect(
      screen.queryByText('Geschützter Seiteninhalt')
    ).toBeNull()
  })
})
