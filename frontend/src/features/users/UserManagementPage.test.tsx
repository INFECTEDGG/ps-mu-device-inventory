// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { useAuthSession } from '../../hooks/useAuthSession'
import { userApi, UserApiError, type ManagedUser } from './userApi'
import { UserManagementPage } from './UserManagementPage'

vi.mock('../../hooks/useAuthSession', () => ({ useAuthSession: vi.fn() }))
vi.mock('./userApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./userApi')>()
  return {
    ...actual,
    userApi: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deactivate: vi.fn(),
      assignRole: vi.fn(),
      getPermissions: vi.fn(),
      setPermissions: vi.fn(),
    },
  }
})
const user: ManagedUser = {
  id: '00000000-0000-4000-8000-000000000002',
  first_name: 'Kim',
  last_name: 'Test',
  email: 'kim@example.invalid',
  role: 'employee',
  disabled_at: null,
  login_blocked: false,
}
function auth(role: 'super_admin' | 'admin' | 'employee' | 'device_manager' = 'admin') {
  vi.mocked(useAuthSession).mockReturnValue({
    session: {} as Session,
    user: null,
    userId: '00000000-0000-4000-8000-000000000001',
    role,
    permissions: null,
    isLoading: false,
    isRoleLoading: false,
    isSigningOut: false,
    profileError: null,
    sessionNotice: null,
    clearSessionNotice: vi.fn(),
    reloadProfile: vi.fn(),
  })
}
describe('Benutzerverwaltung', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    auth()
    vi.mocked(userApi.list).mockResolvedValue({ users: [user], total: 1 })
    vi.mocked(userApi.create).mockResolvedValue({ ok: true })
    vi.mocked(userApi.update).mockResolvedValue({ ok: true })
    vi.mocked(userApi.deactivate).mockResolvedValue({ ok: true })
    vi.mocked(userApi.assignRole).mockResolvedValue({ ok: true })
  })
  afterEach(cleanup)

  it('zeigt Benutzer, Rolle und Status', async () => {
    render(<UserManagementPage />)
    expect(await screen.findByText(user.email!)).toBeTruthy()
    expect(screen.getByText('Mitarbeiter')).toBeTruthy()
    expect(screen.getByText('Aktiv')).toBeTruthy()
  })
  it.each(['employee', 'device_manager'] as const)(
    'verweigert %s die Seite ohne Datenabruf',
    (role) => {
      auth(role)
      render(<UserManagementPage />)
      expect(screen.getByText('Zugriff verweigert')).toBeTruthy()
      expect(userApi.list).not.toHaveBeenCalled()
    },
  )
  it('legt Benutzer mit initialem Passwort an und entfernt anschließend das Passwortfeld', async () => {
    render(<UserManagementPage />)
    await screen.findByText(user.email!)
    fireEvent.click(screen.getByRole('button', { name: 'Benutzer anlegen' }))
    for (const [label, value] of [
      ['Vorname', 'Robin'],
      ['Nachname', 'Neu'],
      ['E-Mail', 'robin@example.invalid'],
      ['Initiales Passwort', 'a-long-initial-password'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText('Benutzer angelegt.')
    expect(userApi.create).toHaveBeenCalledWith({
      first_name: 'Robin',
      last_name: 'Neu',
      email: 'robin@example.invalid',
      password: 'a-long-initial-password',
    })
    expect(screen.queryByLabelText('Initiales Passwort')).toBeNull()
  })
  it('bearbeitet nur Namen; Rollen und E-Mail sind nicht editierbar', async () => {
    render(<UserManagementPage />)
    await screen.findByText(user.email!)
    fireEvent.click(screen.getByRole('button', { name: 'Kim Test bearbeiten' }))
    expect(screen.queryByLabelText('E-Mail')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.change(screen.getByLabelText('Vorname'), {
      target: { value: 'Kimberly' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(userApi.update).toHaveBeenCalledWith(user.id, {
        first_name: 'Kimberly',
        last_name: 'Test',
      }),
    )
  })
  it('deaktiviert erst nach ausdrücklicher Bestätigung', async () => {
    render(<UserManagementPage />)
    await screen.findByText(user.email!)
    fireEvent.click(screen.getByRole('button', { name: 'Deaktivieren' }))
    expect(userApi.deactivate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(userApi.deactivate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Deaktivieren' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Deaktivierung bestätigen' }),
    )
    await waitFor(() =>
      expect(userApi.deactivate).toHaveBeenCalledWith(user.id),
    )
  })
  it('zeigt den unvollständigen Auth-Ban als wiederholbaren Zustand', async () => {
    vi.mocked(userApi.deactivate).mockRejectedValue(
      new UserApiError('Anmeldesperre ausstehend.', 'ban_pending'),
    )
    render(<UserManagementPage />)
    await screen.findByText(user.email!)
    vi.mocked(userApi.list).mockResolvedValue({
      users: [{ ...user, disabled_at: new Date().toISOString() }],
      total: 1,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Deaktivieren' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Deaktivierung bestätigen' }),
    )
    expect(
      await screen.findByRole('button', { name: 'Sperre abschließen' }),
    ).toBeTruthy()
  })
  it('zeigt Ladefehler und bietet erneutes Laden an', async () => {
    vi.mocked(userApi.list).mockRejectedValueOnce(
      new Error('Verbindung fehlgeschlagen.'),
    )
    render(<UserManagementPage />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(await screen.findByText(user.email!)).toBeTruthy()
  })
  it('entfernt das initiale Passwort nach einem fehlgeschlagenen Anlageversuch', async () => {
    vi.mocked(userApi.create).mockRejectedValueOnce(
      new UserApiError('E-Mail bereits vergeben.', 'email_exists'),
    )
    render(<UserManagementPage />)
    await screen.findByText(user.email!)
    fireEvent.click(screen.getByRole('button', { name: 'Benutzer anlegen' }))
    for (const [label, value] of [
      ['Vorname', 'Robin'],
      ['Nachname', 'Neu'],
      ['E-Mail', 'kim@example.invalid'],
      ['Initiales Passwort', 'a-long-initial-password'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByRole('alert')
    expect(
      (screen.getByLabelText('Initiales Passwort') as HTMLInputElement).value,
    ).toBe('')
  })
  it('Admin darf Mitarbeiter zum Gerätemanager machen', async () => {
    render(<UserManagementPage />)
    await screen.findByText(user.email!)
    fireEvent.click(screen.getByRole('button', { name: 'Rolle zuweisen' }))
    fireEvent.change(screen.getByLabelText('Neue Rolle'), { target: { value: 'device_manager' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText(/Rolle gespeichert/)
    expect(userApi.assignRole).toHaveBeenCalledWith(user.id, 'device_manager')
    expect(screen.queryByRole('option', { name: 'Administrator' })).toBeNull()
  })
  it('Nur SuperAdmin darf Administrator ernennen', async () => {
    auth('super_admin')
    render(<UserManagementPage />)
    await screen.findByText(user.email!)
    fireEvent.click(screen.getByRole('button', { name: 'Rolle zuweisen' }))
    fireEvent.change(screen.getByLabelText('Neue Rolle'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText(/Rolle gespeichert/)
    expect(userApi.assignRole).toHaveBeenCalledWith(user.id, 'admin')
  })

})
