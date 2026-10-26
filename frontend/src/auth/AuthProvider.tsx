import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Role } from '../config/permissions'
import { serverSessionGuardEnabled } from '../config/auth'
import { supabase } from '../lib/supabase'
import { getSessionActivityKey, getSupabaseSessionId } from '../lib/sessionKey'
import { watchSessionActivity } from '../lib/sessionActivity'
import { isLogoutPending, subscribeLogout } from '../lib/authOperations'
import { logout } from '../lib/logout'
import { watchInventorySession } from '../lib/serverSession'
import { createInventorySessionClient } from '../services/inventorySessionClient'
import { loadUserRole, UserRoleError, type RoleLookupClient } from '../services/loadUserRole'
import { AuthContext } from './AuthContext'

function createRoleLookup(): RoleLookupClient | null {
  const client = supabase
  if (!client) return null
  return {
    getProfile: (userId) => client.from('profiles').select('role_id').eq('id', userId).maybeSingle(),
    getRole: (roleId) => client.from('roles').select('name').eq('id', roleId).maybeSingle(),
  }
}

const roleLookup = createRoleLookup()

interface RoleState {
  key: string | null
  role: Role | null
  error: string | null
}

interface ServerSessionState {
  key: string | null
  error: string | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [roleState, setRoleState] = useState<RoleState>({ key: null, role: null, error: null })
  const [profileVersion, setProfileVersion] = useState(0)
  const [serverVersion, setServerVersion] = useState(0)
  const [serverState, setServerState] = useState<ServerSessionState>({ key: null, error: null })
  const isSigningOut = useSyncExternalStore(subscribeLogout, isLogoutPending, () => false)
  const expiredSession = useRef<string | null>(null)
  const latestSessionKey = useRef<string | null>(null)
  const sessionKey = session ? getSessionActivityKey(session) : null
  const sessionId = session ? getSupabaseSessionId(session) : null
  const inventorySessionClient = useMemo(() => sessionId ? createInventorySessionClient(sessionId) : null, [sessionId])
  const userId = session?.user.id ?? null
  const roleKey = sessionKey ? `${sessionKey}:${profileVersion}` : null
  const serverKey = serverSessionGuardEnabled && sessionKey ? `${sessionKey}:${serverVersion}` : null
  const serverChecked = serverKey !== null && serverState.key === serverKey
  const serverReady = !serverSessionGuardEnabled || (serverChecked && serverState.error === null)

  const expireSession = useCallback((key: string, notice: string) => {
    if (latestSessionKey.current !== key) return
    expiredSession.current = key
    latestSessionKey.current = null
    setSession(null)
    setSessionNotice(notice)
    void logout(key).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false)
      return
    }

    // Der Callback bleibt synchron; Datenbankabfragen laufen in einem eigenen Effect.
    const { data } = supabase.auth.onAuthStateChange((event, currentSession) => {
      const key = currentSession ? getSessionActivityKey(currentSession) : null
      if (currentSession && (!key || key === expiredSession.current)) {
        latestSessionKey.current = null
        setSession(null)
        setSessionNotice('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.')
      } else {
        latestSessionKey.current = key
        setSession(currentSession)
        if (currentSession) setSessionNotice(null)
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          setProfileVersion((version) => version + 1)
        }
      }
      setIsLoading(false)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessionKey || serverSessionGuardEnabled) return

    return watchSessionActivity(sessionKey, () => {
      expireSession(sessionKey, 'Du wurdest nach 30 Minuten ohne Aktivität abgemeldet. Bitte melde dich erneut an.')
    })
  }, [sessionKey, expireSession])

  useEffect(() => {
    if (!serverKey || !sessionKey || !sessionId) return

    return watchInventorySession({
      client: inventorySessionClient,
      sessionId,
      onChecking: () => {
        if (latestSessionKey.current === sessionKey) setServerState({ key: null, error: null })
      },
      onReady: () => {
        if (latestSessionKey.current === sessionKey) setServerState({ key: serverKey, error: null })
      },
      onExpired: () => {
        expireSession(sessionKey, 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.')
      },
      onError: () => {
        if (latestSessionKey.current === sessionKey) {
          setServerState({
            key: serverKey,
            error: 'Deine Sitzung konnte nicht geprüft werden. Bitte versuche es erneut.',
          })
        }
      },
    })
  }, [serverKey, sessionKey, sessionId, inventorySessionClient, expireSession])

  useEffect(() => {
    if (!roleKey || !userId || !serverReady) return
    let cancelled = false

    void loadUserRole(userId, roleLookup).then(
      (role) => {
        if (!cancelled) setRoleState({ key: roleKey, role, error: null })
      },
      (error: unknown) => {
        if (!cancelled) {
          setRoleState({
            key: roleKey,
            role: null,
            error: error instanceof UserRoleError
              ? error.message
              : 'Deine Zugriffsberechtigungen konnten nicht geladen werden. Bitte versuche es erneut.',
          })
        }
      },
    )

    return () => { cancelled = true }
  }, [roleKey, userId, serverReady])

  const reloadProfile = useCallback(() => {
    setProfileVersion((version) => version + 1)
    setServerVersion((version) => version + 1)
  }, [])
  const clearSessionNotice = useCallback(() => setSessionNotice(null), [])
  const currentRole = roleKey !== null && roleState.key === roleKey
  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    userId,
    role: serverReady && currentRole ? roleState.role : null,
    isLoading,
    isRoleLoading: Boolean(session) && (
      (serverSessionGuardEnabled && !serverChecked) || (serverReady && !currentRole)
    ),
    isSigningOut,
    profileError: serverSessionGuardEnabled && serverChecked && serverState.error
      ? serverState.error
      : currentRole ? roleState.error : null,
    sessionNotice,
    clearSessionNotice,
    reloadProfile,
  }), [session, userId, currentRole, roleState, serverReady, serverChecked, serverState, isLoading, isSigningOut, sessionNotice, clearSessionNotice, reloadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
