export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000

const CHECK_INTERVAL_MS = 30_000
const WRITE_INTERVAL_MS = 1_000
const STORAGE_PREFIX = 'device-inventory:activity:'

interface SessionActivityRuntime {
  wallNow: () => number
  monotonicNow: () => number
  read: (key: string) => string | null
  write: (key: string, value: string) => void
  listenActivity: (listener: (trusted: boolean) => void) => () => void
  listenCheck: (listener: () => void) => () => void
  listenStorage: (listener: (key: string | null, value: string | null) => void) => () => void
  schedule: (callback: () => void, delay: number) => unknown
  cancel: (timer: unknown) => void
}

function browserRuntime(): SessionActivityRuntime {
  return {
    wallNow: () => Date.now(),
    monotonicNow: () => performance.now(),
    read: (key) => window.localStorage.getItem(key),
    write: (key, value) => window.localStorage.setItem(key, value),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (timer) => window.clearTimeout(timer as number),
    listenActivity: (listener) => {
      const handleActivity = (event: Event) => {
        listener(event.isTrusted && document.visibilityState === 'visible')
      }
      const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
      for (const event of events) window.addEventListener(event, handleActivity, { passive: true })
      return () => {
        for (const event of events) window.removeEventListener(event, handleActivity)
      }
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
    listenStorage: (listener) => {
      const handleStorage = (event: StorageEvent) => {
        if (!event.isTrusted) return
        // Nur Local Storage wird zwischen Tabs geteilt.
        try {
          if (event.storageArea !== null && event.storageArea !== window.localStorage) return
        } catch { return }
        listener(event.key, event.newValue)
      }
      window.addEventListener('storage', handleStorage)
      return () => window.removeEventListener('storage', handleStorage)
    },
  }
}

function parseActivity(value: string | null, now: number): number | null {
  if (value === null) return null
  try {
    const activity: unknown = JSON.parse(value)
    if (typeof activity !== 'number' || !Number.isFinite(activity) || activity < 0 || activity > now) return null
    return activity
  } catch { return null }
}

/**
 * Lokale Abmeldung; API-Zugriffe müssen zusätzlich auf dem Server geprüft werden.
 * Gespeichert wird nur der Aktivitätszeitpunkt. Ohne Local Storage gilt die Frist
 * nur im aktuellen Tab. Bei abruptem Schließen kann die letzte Sekunde fehlen.
 */
export function watchSessionActivity(
  sessionKey: string,
  onExpire: () => void,
  runtime: SessionActivityRuntime = browserRuntime(),
): () => void {
  const storageKey = `${STORAGE_PREFIX}${sessionKey}`
  let stopped = false
  let persistent = true
  let checkTimer: unknown
  let writeTimer: unknown
  let lastActivity = runtime.wallNow()
  let effectiveTime = lastActivity
  let lastMonotonic = runtime.monotonicNow()
  let lastWrittenActivity = lastActivity
  let lastWriteTime = -Infinity
  const removeListeners: Array<() => void> = []

  // Browserpausen mitzählen und die Frist bei zurückgestellter Uhr weiterlaufen lassen.
  const now = () => {
    const monotonic = runtime.monotonicNow()
    effectiveTime = Math.max(
      runtime.wallNow(),
      effectiveTime + Math.max(0, monotonic - lastMonotonic),
    )
    lastMonotonic = monotonic
    // Ganze Millisekunden verhindern Rundungsunterschiede zwischen Tabs.
    return Math.floor(effectiveTime)
  }

  const cancelTimers = () => {
    if (checkTimer !== undefined) runtime.cancel(checkTimer)
    if (writeTimer !== undefined) runtime.cancel(writeTimer)
    checkTimer = undefined
    writeTimer = undefined
  }

  const expire = () => {
    if (stopped) return
    stopped = true
    cancelTimers()
    for (const remove of removeListeners) remove()
    onExpire()
  }

  const read = () => {
    if (!persistent) return undefined
    try { return runtime.read(storageKey) }
    catch {
      persistent = false
      return undefined
    }
  }

  const write = (time: number) => {
    if (!persistent) return
    try {
      runtime.write(storageKey, JSON.stringify(lastActivity))
      lastWrittenActivity = lastActivity
      lastWriteTime = time
    } catch {
      // Bei Speicherfehlern läuft die bestehende Frist lokal weiter.
      persistent = false
    }
  }

  const synchronize = (time: number, value = read()) => {
    if (value === undefined) return true // Nach Speicherfehlern lokal weiterprüfen.
    const shared = parseActivity(value, time)
    if (shared === null) {
      expire()
      return false
    }
    lastActivity = Math.max(lastActivity, shared)
    lastWrittenActivity = shared
    return true
  }

  const isCurrent = (time: number) => {
    if (stopped || !synchronize(time)) return false
    if (time - lastActivity >= INACTIVITY_TIMEOUT_MS) {
      expire()
      return false
    }
    return true
  }

  const scheduleCheck = (time: number) => {
    if (stopped || checkTimer !== undefined) return
    checkTimer = runtime.schedule(() => {
      checkTimer = undefined
      check()
    }, Math.min(CHECK_INTERVAL_MS, INACTIVITY_TIMEOUT_MS - (time - lastActivity)))
  }

  const check = () => {
    const time = now()
    if (isCurrent(time)) scheduleCheck(time)
  }

  const persistActivity = (time: number) => {
    if (!persistent || lastActivity <= lastWrittenActivity) return
    const delay = Math.max(0, lastWriteTime + WRITE_INTERVAL_MS - time)
    if (delay === 0) {
      write(time)
    } else if (writeTimer === undefined) {
      writeTimer = runtime.schedule(() => {
        writeTimer = undefined
        const flushTime = now()
        // Den Zeitpunkt der Eingabe speichern, nicht den des Schreibvorgangs.
        if (isCurrent(flushTime) && lastActivity > lastWrittenActivity) write(flushTime)
      }, delay)
    }
  }

  const activity = (trusted: boolean) => {
    if (!trusted || stopped) return
    const time = now()
    // Ein Klick nach Fristablauf darf die Sitzung nicht wieder aktivieren.
    if (!isCurrent(time)) return
    lastActivity = time
    persistActivity(time)
    scheduleCheck(time)
  }

  const initial = read()
  if (initial === null) {
    write(lastActivity)
  } else if (initial !== undefined) {
    const shared = parseActivity(initial, effectiveTime)
    if (shared === null) {
      expire()
      return () => undefined
    }
    lastActivity = shared
    lastWrittenActivity = shared
  }

  if (effectiveTime - lastActivity >= INACTIVITY_TIMEOUT_MS) {
    expire()
    return () => undefined
  }

  removeListeners.push(
    runtime.listenActivity(activity),
    runtime.listenCheck(check),
    runtime.listenStorage((key, value) => {
      if (stopped || (key !== null && key !== storageKey)) return
      const time = now()
      if (synchronize(time, value) && isCurrent(time)) scheduleCheck(time)
    }),
  )
  scheduleCheck(effectiveTime)

  return () => {
    if (stopped) return
    // Vor dem Neuladen ausstehende Eingaben speichern. Neuere Daten anderer Tabs
    // und gelöschte oder ungültige Einträge dabei unverändert lassen.
    if (persistent && lastActivity > lastWrittenActivity) {
      const time = now()
      const shared = parseActivity(read() ?? null, time)
      if (shared !== null && time - lastActivity < INACTIVITY_TIMEOUT_MS && lastActivity > shared) write(time)
    }
    stopped = true
    cancelTimers()
    for (const remove of removeListeners) remove()
  }
}
