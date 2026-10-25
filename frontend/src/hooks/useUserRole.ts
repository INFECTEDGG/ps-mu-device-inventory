
import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '../config/permissions'
import { loadUserRole } from '../services/loadUserRole'

interface UserRoleState {
  userId: string | null
  role: Role | null
  loading: boolean
  error: string | null
}

export function useUserRole(
  supabase: SupabaseClient,
  userId: string | null
) {
  const [state, setState] = useState<UserRoleState>({
    userId: null,
    role: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    let active = true

    // Ohne angemeldeten Benutzer keine Berechtigungen
    if (!userId) {
      setState({
        userId: null,
        role: null,
        loading: false,
        error: null,
      })
      return
    }

    // Rolle wird geladen
    setState({
      userId,
      role: null,
      loading: true,
      error: null,
    })

    // Benutzerrolle aus Supabase laden
    void loadUserRole(supabase, userId)
      .then((role) => {
        if (!active) return

        setState({
          userId,
          role,
          loading: false,
          error: null,
        })
      })
      .catch((error: unknown) => {
        if (!active) return

        setState({
          userId,
          role: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Benutzerrolle konnte nicht geladen werden.',
        })
      })

    // Verhindert veraltete Ergebnisse bei Benutzerwechsel
    return () => {
      active = false
    }
  }, [supabase, userId])

  const isCurrentUser = state.userId === userId

  return {
    role: isCurrentUser ? state.role : null,
    isLoading: userId !== null &&
      (!isCurrentUser || state.loading),
    error: isCurrentUser ? state.error : null,
  }
}
