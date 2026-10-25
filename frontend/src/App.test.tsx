
 // @vitest-environment jsdom

import type { ReactNode } from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useAppNavigation } from './hooks/useAppNavigation'
import App from './App'

vi.mock('./hooks/useAppNavigation', () => ({
  useAppNavigation: vi.fn(),
}))

// Layout isolieren, damit wir die Seitenberechtigung testen.
vi.mock('./components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('./pages/PlaceholderPage', () => ({
  PlaceholderPage: () => <div>Geschützter Seiteninhalt</div>,
}))

vi.mock('./pages/NotFoundPage', () => ({
  NotFoundPage: () => <div>Seite nicht gefunden</div>,
}))

function setCurrentPath(path: string) {
  vi.mocked(useAppNavigation).mockReturnValue({
    currentPath: path,
    navigate: vi.fn(),
  })
}

describe('Seitenzugriff nach Benutzerrolle', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('Admin darf Benutzerverwaltung öffnen', () => {
    setCurrentPath('/benutzerverwaltung')

    render(<App role="admin" />)

    expect(
      screen.getByText('Geschützter Seiteninhalt')
    ).toBeTruthy()
  })

  it('Mitarbeiter darf Benutzerverwaltung nicht öffnen', () => {
    setCurrentPath('/benutzerverwaltung')

    render(<App role="employee" />)

    expect(
      screen.getByText('Zugriff verweigert')
    ).toBeTruthy()
  })

  it('Gerätemanager darf Benutzerverwaltung nicht öffnen', () => {
    setCurrentPath('/benutzerverwaltung')

    render(<App role="device_manager" />)

    expect(
      screen.getByText('Zugriff verweigert')
    ).toBeTruthy()
  })

  it('Benutzer ohne Rolle erhält keinen Zugriff', () => {
    setCurrentPath('/geraete')

    render(<App role={null} />)

    expect(
      screen.getByText('Zugriff verweigert')
    ).toBeTruthy()
  })
})
