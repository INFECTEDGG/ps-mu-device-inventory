// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { useAuthSession } from '../../hooks/useAuthSession'
import { userApi } from '../users/userApi'
import { RolePermissionsPage } from './RolePermissionsPage'

vi.mock('../../hooks/useAuthSession', () => ({ useAuthSession: vi.fn() }))
vi.mock('../users/userApi', () => ({ userApi: { getPermissions: vi.fn(), setPermissions: vi.fn() } }))

function auth(role: 'admin'|'super_admin') {
  vi.mocked(useAuthSession).mockReturnValue({
    session: {} as Session, user: null, userId: 'user-id', role, permissions: null,
    isLoading: false, isRoleLoading: false, isSigningOut: false, profileError: null,
    sessionNotice: null, clearSessionNotice: vi.fn(), reloadProfile: vi.fn(),
  })
}

describe('SuperAdmin-Berechtigungsseite', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    auth('super_admin')
    vi.mocked(userApi.getPermissions).mockResolvedValue({
      admin: ['dashboard:view', 'users:manage'],
      device_manager: ['dashboard:view'],
      employee: ['dashboard:view'],
    })
    vi.mocked(userApi.setPermissions).mockResolvedValue({ ok: true })
  })
  afterEach(cleanup)

  it('verweigert normalen Admins die Seite ohne Backendabruf', () => {
    auth('admin')
    render(<RolePermissionsPage />)
    expect(screen.getByText('Zugriff verweigert')).toBeTruthy()
    expect(userApi.getPermissions).not.toHaveBeenCalled()
  })
  it('speichert nur editierbare Rechte, nicht users:manage', async () => {
    render(<RolePermissionsPage />)
    const checkbox = await screen.findByRole('checkbox', { name: 'Geräte verwalten – Mitarbeiter' })
    fireEvent.click(checkbox)
    const saveButtons = screen.getAllByRole('button', { name: 'Speichern' })
    fireEvent.click(saveButtons[2])
    await waitFor(() => expect(userApi.setPermissions).toHaveBeenCalledWith('employee', ['dashboard:view', 'devices:manage']))
  })
})
