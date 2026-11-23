import { supabase } from './supabase'
import { runLogout, runLogoutIfCurrent } from './authOperations.ts'
import { getSessionActivityKey, getSupabaseSessionId } from './sessionKey.ts'
import { serverSessionGuardEnabled } from '../config/auth'
import { endInventorySession } from './serverSession'
import { createInventorySessionClient } from '../services/inventorySessionClient'

export function logout(expectedSessionKey?: string): Promise<void> {
  const operation = async () => {
    if (!supabase) {
      throw new Error('Die Abmeldung ist derzeit nicht verfügbar.')
    }

    try {
      if (serverSessionGuardEnabled) {
        try {
          const current = await supabase.auth.getSession()
          const sessionId = current.data.session ? getSupabaseSessionId(current.data.session) : null
          if (sessionId) await endInventorySession(createInventorySessionClient(sessionId), sessionId)
        } catch {
          // Supabase trotzdem abmelden: Eine gelöschte Auth-Sitzung sperrt ebenfalls den Zugriff.
          // Ohne Verbindung lässt sich die Abmeldung auf dem Server nicht bestätigen.
        }
      }
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch {
      throw new Error('Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.')
    }
  }

  if (expectedSessionKey !== undefined) {
    return runLogoutIfCurrent(expectedSessionKey, async () => {
      if (!supabase) throw new Error('Die Abmeldung ist derzeit nicht verfügbar.')
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        return data.session ? getSessionActivityKey(data.session) : null
      } catch {
        throw new Error('Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.')
      }
    }, operation)
  }
  return runLogout(operation)
}
