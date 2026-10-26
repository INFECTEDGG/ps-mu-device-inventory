import { describe, expect, it, vi } from 'vitest'
import {
  loadUserRole,
  type RoleLookupClient,
} from './loadUserRole'

type LookupResponse<T> = {
  data: T | null
  error: unknown
}

interface MockOptions {
  profile?: LookupResponse<{ role_id: unknown }>
  role?: LookupResponse<{ name: unknown }>
}

// Simuliert die Datenbankabfragen.
// Es wird keine echte Supabase-Verbindung hergestellt.
function createMockClient({
  profile = {
    data: { role_id: 2 },
    error: null,
  },
  role = {
    data: { name: 'device_manager' },
    error: null,
  },
}: MockOptions = {}) {
  const getProfile = vi.fn(async (_userId: string) => profile)

  const getRole = vi.fn(
    async (_roleId: string | number) => role,
  )

  const client: RoleLookupClient = {
    getProfile,
    getRole,
  }

  return { client, getProfile, getRole }
}

describe('RBAC - Benutzerrolle aus Supabase laden', () => {
  it('lädt die Rolle eines Gerätemanagers', async () => {
    const { client, getProfile, getRole } = createMockClient()

    const result = await loadUserRole('test-user-id', client)

    expect(result).toBe('device_manager')
    expect(getProfile).toHaveBeenCalledWith('test-user-id')
    expect(getRole).toHaveBeenCalledWith(2)
  })

  it('lädt die Admin-Rolle', async () => {
    const { client } = createMockClient({
      profile: { data: { role_id: 1 }, error: null },
      role: { data: { name: 'admin' }, error: null },
    })

    await expect(
      loadUserRole('admin-user', client)
    ).resolves.toBe('admin')
  })

  it('erkennt fehlende Benutzerprofile', async () => {
    const { client, getRole } = createMockClient({
      profile: { data: null, error: null },
    })

    await expect(
      loadUserRole('test-user-id', client)
    ).rejects.toMatchObject({
      code: 'profile_missing',
    })

    expect(getRole).not.toHaveBeenCalled()
  })

  it('verweigert Zugriff bei fehlender Rollen-ID', async () => {
    const { client } = createMockClient({
      profile: {
        data: { role_id: null },
        error: null,
      },
    })

    await expect(
      loadUserRole('test-user-id', client)
    ).rejects.toMatchObject({
      code: 'role_missing',
    })
  })

  it('akzeptiert keine unbekannten Rollen', async () => {
    const { client } = createMockClient({
      role: {
        data: { name: 'superadmin' },
        error: null,
      },
    })

    await expect(
      loadUserRole('test-user-id', client)
    ).rejects.toMatchObject({
      code: 'role_missing',
    })
  })

  it('behandelt Fehler beim Laden des Profils', async () => {
    const { client } = createMockClient({
      profile: {
        data: null,
        error: { message: 'Datenbank nicht erreichbar' },
      },
    })

    await expect(
      loadUserRole('test-user-id', client)
    ).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('behandelt Fehler beim Laden der Rolle', async () => {
    const { client } = createMockClient({
      role: {
        data: null,
        error: { message: 'Rollenabfrage fehlgeschlagen' },
      },
    })

    await expect(
      loadUserRole('test-user-id', client)
    ).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('verweigert Zugriff ohne Datenbank-Client', async () => {
    await expect(
      loadUserRole('test-user-id', null)
    ).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('verweigert Zugriff ohne Benutzer-ID', async () => {
    const { client, getProfile } = createMockClient()

    await expect(
      loadUserRole('', client)
    ).rejects.toMatchObject({
      code: 'unavailable',
    })

    expect(getProfile).not.toHaveBeenCalled()
  })
})
