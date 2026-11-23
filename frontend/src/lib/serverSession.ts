export const SERVER_SESSION_POLL_MS = 30_000
export const SERVER_SESSION_TOUCH_INTERVAL_MS = 30_000
const MAX_INACTIVITY_MS = 30 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface InventorySessionClient {
  rpc(name: string): PromiseLike<{ data: unknown; error: unknown }>
}

export interface InventorySessionStatus {
  active: boolean
  sessionId: string | null
  userId: string | null
  expiresAt: number | null
  serverNow: number
  reason: 'active' | 'missing' | 'expired' | 'revoked' | 'invalid'
}

export class ServerSessionError extends Error {
  readonly code: 'unavailable' | 'invalid_response'

  constructor(code: 'unavailable' | 'invalid_response' = 'unavailable') {
    super('Deine Sitzung konnte nicht geprüft werden. Bitte versuche es erneut.')
    this.code = code
  }
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function nullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && UUID.test(value))
}

function parseStatus(data: unknown, expectedSessionId: string): InventorySessionStatus {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ServerSessionError('invalid_response')
  const status = data as Record<string, unknown>
  const { active, sessionId, userId, expiresAt, serverNow, reason } = status
  if (typeof active !== 'boolean' || !nullableUuid(sessionId) || !nullableUuid(userId)
    || !timestamp(serverNow) || !(expiresAt === null || timestamp(expiresAt))
    || (reason !== 'active' && reason !== 'missing' && reason !== 'expired' && reason !== 'revoked' && reason !== 'invalid')
    || (sessionId !== null && sessionId !== expectedSessionId)) {
    throw new ServerSessionError('invalid_response')
  }
  if (active) {
    if (sessionId === null || userId === null || reason !== 'active' || expiresAt === null
      || expiresAt <= serverNow || expiresAt - serverNow > MAX_INACTIVITY_MS) {
      throw new ServerSessionError('invalid_response')
    }
  } else if (reason === 'active') {
    throw new ServerSessionError('invalid_response')
  }
  return { active, sessionId, userId, expiresAt, serverNow, reason }
}

async function callSessionRpc(
  client: InventorySessionClient | null,
  expectedSessionId: string,
  name: string,
): Promise<InventorySessionStatus> {
  if (!client || !UUID.test(expectedSessionId)) throw new ServerSessionError()
  try {
    // Sitzung und Uhrzeit bestimmt der Server. Die ID prüfen wir nur in der Antwort.
    const { data, error } = await client.rpc(name)
    if (error) throw new ServerSessionError()
    return parseStatus(data, expectedSessionId)
  } catch (error) {
    if (error instanceof ServerSessionError) throw error
    throw new ServerSessionError()
  }
}

export function startInventorySession(client: InventorySessionClient | null, sessionId: string) {
  return callSessionRpc(client, sessionId, 'inventory_session_start')
}

export function getInventorySession(client: InventorySessionClient | null, sessionId: string) {
  return callSessionRpc(client, sessionId, 'inventory_session_status')
}

export function touchInventorySession(client: InventorySessionClient | null, sessionId: string) {
  return callSessionRpc(client, sessionId, 'inventory_session_touch')
}

export async function endInventorySession(client: InventorySessionClient | null, sessionId: string) {
  const status = await callSessionRpc(client, sessionId, 'inventory_session_end')
  if (status.active) throw new ServerSessionError('invalid_response')
  return status
}

export interface ServerSessionRuntime {
  monotonicNow: () => number
  wallNow: () => number
  listenActivity: (listener: (trusted: boolean) => void) => () => void
  listenCheck: (listener: () => void) => () => void
  schedule: (callback: () => void, delay: number) => unknown
  cancel: (timer: unknown) => void
}

function browserRuntime(): ServerSessionRuntime {
  return {
    monotonicNow: () => performance.now(),
    wallNow: () => Date.now(),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (timer) => window.clearTimeout(timer as number),
    listenActivity: (listener) => {
      const handle = (event: Event) => listener(event.isTrusted && document.visibilityState === 'visible')
      const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
      for (const event of events) window.addEventListener(event, handle, { passive: true })
      return () => { for (const event of events) window.removeEventListener(event, handle) }
    },
    listenCheck: (listener) => {
      window.addEventListener('focus', listener)
      window.addEventListener('pageshow', listener)
      document.addEventListener('visibilitychange', listener)
      return () => {
        window.removeEventListener('focus', listener)
        window.removeEventListener('pageshow', listener)
        document.removeEventListener('visibilitychange', listener)
      }
    },
  }
}

interface WatchOptions {
  client: InventorySessionClient | null
  sessionId: string
  onReady: (status: InventorySessionStatus) => void
  onChecking?: () => void
  onExpired: (status: InventorySessionStatus) => void
  onError: (error: ServerSessionError) => void
  runtime?: ServerSessionRuntime
}

/**
 * Die Serverfrist zählt ab der letzten bestätigten Aktivität. Nur echte Eingaben
 * im sichtbaren Tab lösen ein Touch aus, höchstens alle 30 Sekunden und ohne
 * nachlaufenden Timer. Statusabfragen verlängern die Frist nicht. Die Drosselung
 * kann die Restzeit nach einer Eingabe um bis zu 30 Sekunden verkürzen.
 */
export function watchInventorySession(options: WatchOptions): () => void {
  const { client, sessionId, onReady, onChecking, onExpired, onError } = options
  const runtime = options.runtime ?? browserRuntime()
  let stopped = false
  let ready = false
  let checkingDeadline = false
  let inFlight = false
  let pendingStatus = false
  let pendingTouch = false
  let deadline = Infinity
  let lastTouchIntent = -Infinity
  let checkTimer: unknown
  const removers: Array<() => void> = []
  let effectiveNow = runtime.monotonicNow()
  let lastMonotonic = effectiveNow
  let lastWall = runtime.wallNow()

  const now = () => {
    const monotonic = runtime.monotonicNow()
    const wall = runtime.wallNow()
    // Zeitdifferenzen vermeiden eine Abhängigkeit von der eingestellten Uhrzeit.
    // Date.now erkennt auch Pausen, in denen performance.now stehen bleibt.
    effectiveNow += Math.max(0, monotonic - lastMonotonic, wall - lastWall)
    lastMonotonic = monotonic
    lastWall = wall
    return effectiveNow
  }

  const cleanup = () => {
    if (checkTimer !== undefined) runtime.cancel(checkTimer)
    checkTimer = undefined
    pendingStatus = false
    pendingTouch = false
    for (const remove of removers) remove()
  }

  const fail = (error: unknown) => {
    if (stopped) return
    stopped = true
    cleanup()
    try { onError(error instanceof ServerSessionError ? error : new ServerSessionError()) }
    catch { /* Die Sitzung bleibt auch bei einem Fehler im Callback gestoppt. */ }
  }

  const markDeadlineCheck = () => {
    if (stopped || !ready || checkingDeadline || now() < deadline) return
    checkingDeadline = true
    try { onChecking?.() }
    catch (error) { fail(error) }
  }

  const scheduleCheck = () => {
    if (stopped) return
    if (checkTimer !== undefined) runtime.cancel(checkTimer)
    checkTimer = runtime.schedule(() => {
      checkTimer = undefined
      request('status')
    }, Math.max(0, Math.min(SERVER_SESSION_POLL_MS, deadline - now())))
  }

  const run = async (kind: 'start' | 'status' | 'touch') => {
    if (stopped) return
    inFlight = true
    const requestStart = now()
    try {
      const status = await (kind === 'start'
        ? startInventorySession(client, sessionId)
        : kind === 'touch'
          ? touchInventorySession(client, sessionId)
          : getInventorySession(client, sessionId))
      if (stopped) return
      if (!status.active) {
        stopped = true
        cleanup()
        onExpired(status)
        return
      }
      ready = true
      deadline = requestStart + (status.expiresAt! - status.serverNow)
      if (deadline <= now()) {
        // Bei einer verspäteten Antwort vor der Freigabe noch einmal prüfen.
        markDeadlineCheck()
        pendingStatus = true
      } else {
        checkingDeadline = false
        onReady(status)
        scheduleCheck()
      }
    } catch (error) {
      fail(error)
    } finally {
      inFlight = false
      if (!stopped) {
        if (pendingStatus) {
          pendingStatus = false
          void run('status')
        } else if (pendingTouch) {
          pendingTouch = false
          void run('touch')
        }
      }
    }
  }

  const request = (kind: 'status' | 'touch') => {
    if (stopped || !ready) return
    if (kind === 'status') markDeadlineCheck()
    if (stopped) return
    if (inFlight) {
      if (kind === 'touch') pendingTouch = true
      else pendingStatus = true
    } else {
      void run(kind)
    }
  }

  try {
    removers.push(runtime.listenActivity((trusted) => {
      if (!trusted || stopped || !ready) return
      const time = now()
      if (time - lastTouchIntent < SERVER_SESSION_TOUCH_INTERVAL_MS) return
      lastTouchIntent = time
      if (time >= deadline) request('status')
      request('touch')
    }))
    removers.push(runtime.listenCheck(() => request('status')))
    void run('start')
  } catch (error) {
    fail(error)
  }

  return () => {
    if (stopped) return
    stopped = true
    cleanup()
  }
}
