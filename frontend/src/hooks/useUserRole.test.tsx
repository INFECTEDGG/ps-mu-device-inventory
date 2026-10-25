
 // @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '../config/permissions'
import { loadUserRole } from '../services/loadUserRole'
import { useUserRole } from './useUserRole'

// Supabase-Abfragen werden simuliert.
// Es erfolgt kein Zugriff auf die echte Datenbank.
vi.mock('../services/loadUserRole', () => ({
  loadUserRole: vi.fn(),
}))

const supabase = {} as SupabaseClient

describe('useUserRole - Rollenverwaltung', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('lädt die Benutzerrolle nach der Anmeldung', async () => {
    vi.mocked(loadUserRole).mockResolvedValue('device_manager')

    const { result } = renderHook(() =>
      useUserRole(supabase, 'user-123')
    )

    await waitFor(() => {
      expect(result.current.role).toBe('device_manager')
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('vergibt keine Berechtigungen ohne Anmeldung', () => {
    const { result } = renderHook(() =>
      useUserRole(supabase, null)
    )

    expect(result.current.role).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(loadUserRole).not.toHaveBeenCalled()
  })

  it('entfernt die Rolle nach dem Logout', async () => {
    vi.mocked(loadUserRole).mockResolvedValue('admin')

    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) =>
        useUserRole(supabase, userId),
      {
        initialProps: {
          userId: 'user-123' as string | null,
        },
      }
    )

    await waitFor(() => {
      expect(result.current.role).toBe('admin')
    })

    // Benutzer meldet sich ab
    rerender({ userId: null })

    expect(result.current.role).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('übernimmt keine alte Rolle beim Benutzerwechsel', async () => {
    let resolveFirst!: (role: Role | null) => void

    const firstRequest = new Promise<Role | null>((resolve) => {
      resolveFirst = resolve
    })

    vi.mocked(loadUserRole)
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce('employee')

    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) =>
        useUserRole(supabase, userId),
      {
        initialProps: {
          userId: 'user-admin' as string | null,
        },
      }
    )

    // Wechsel zum Mitarbeiter
    rerender({ userId: 'user-employee' })

    await waitFor(() => {
      expect(result.current.role).toBe('employee')
    })

    // Die alte Admin-Abfrage wird verspätet abgeschlossen
    await act(async () => {
      resolveFirst('admin')
      await firstRequest
    })

    // Die alte Rolle darf nicht übernommen werden
    expect(result.current.role).toBe('employee')
  })

  it('behandelt Fehler beim Laden der Rolle', async () => {
    vi.mocked(loadUserRole).mockRejectedValue(
      new Error('Datenbank nicht erreichbar')
    )

    const { result } = renderHook(() =>
      useUserRole(supabase, 'user-123')
    )

    await waitFor(() => {
      expect(result.current.error).toBe(
        'Datenbank nicht erreichbar'
      )
    })

    expect(result.current.role).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })
})
