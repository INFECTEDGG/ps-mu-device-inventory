
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadUserRole } from './loadUserRole'

// Simuliert Antworten von Supabase,
// ohne auf die echte Datenbank zuzugreifen.
function createMockClient(
  responses: Array<{
    data: unknown
    error: { message: string } | null
  }>
): SupabaseClient {
  const maybeSingle = vi.fn()

  for (const response of responses) {
    maybeSingle.mockResolvedValueOnce(response)
  }

  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))

  return { from } as unknown as SupabaseClient
}

describe('Benutzerrollen aus Supabase laden', () => {

  it('lädt die Rolle eines Gerätemanagers', async () => {
    const client = createMockClient([
      { data: { role_id: 2 }, error: null },
      { data: { name: 'device_manager' }, error: null },
    ])

    const role = await loadUserRole(client, 'test-user-id')

    expect(role).toBe('device_manager')
  })

  it('verweigert Zugriff bei fehlendem Benutzerprofil', async () => {
    const client = createMockClient([
      { data: null, error: null },
    ])

    const role = await loadUserRole(client, 'test-user-id')

    expect(role).toBeNull()
  })

  it('akzeptiert keine unbekannten Rollen', async () => {
    const client = createMockClient([
      { data: { role_id: 99 }, error: null },
      { data: { name: 'superadmin' }, error: null },
    ])

    const role = await loadUserRole(client, 'test-user-id')

    expect(role).toBeNull()
  })

  it('behandelt Datenbankfehler korrekt', async () => {
    const client = createMockClient([
      {
        data: null,
        error: { message: 'Datenbank nicht erreichbar' },
      },
    ])

    await expect(
      loadUserRole(client, 'test-user-id')
    ).rejects.toThrow('Datenbank nicht erreichbar')
  })
})
