interface SessionIdentity {
  access_token: string
  user: { id: string }
}

export function getSupabaseSessionId(session: SessionIdentity): string | null {
  try {
    const payload = session.access_token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    if (typeof claims.session_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id)) {
      return null
    }

    // Nur Identifikation; die verbindliche JWT-Prüfung übernimmt Supabase.
    return claims.session_id.toLowerCase()
  } catch {
    return null
  }
}

export function getSessionActivityKey(session: SessionIdentity): string | null {
  const sessionId = getSupabaseSessionId(session)
  return sessionId ? `${session.user.id}:${sessionId}` : null
}
