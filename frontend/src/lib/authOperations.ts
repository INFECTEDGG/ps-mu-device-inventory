// Eigener Lock, damit Supabases interner Storage-Lock frei bleibt.
export const AUTH_OPERATION_LOCK_NAME = 'device-inventory:auth-operation'

interface AuthOperationsRuntime {
  withExclusiveLock<T>(operation: () => Promise<T>): Promise<T>
}

/**
 * An- und Abmeldung laufen nacheinander. Web Locks stimmen dafür auch mehrere
 * Tabs ab; ohne sie gilt die Warteschlange nur in diesem Tab. Nach einem
 * Lock-Fehler wird der Vorgang nicht ohne Sperre wiederholt.
 */
export function createAuthOperations(runtime?: AuthOperationsRuntime) {
  const pendingLogouts = new Map<string, Promise<void>>()
  const listeners = new Set<() => void>()
  let localTail: Promise<unknown> = Promise.resolve()

  async function withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (runtime) return runtime.withExclusiveLock(operation)
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(AUTH_OPERATION_LOCK_NAME, { mode: 'exclusive' }, async () => operation())
    }
    const result = localTail.then(operation)
    localTail = result.catch(() => undefined)
    return result
  }

  function notify() {
    for (const listener of [...listeners]) {
      // Ein fehlerhafter Listener darf die Abmeldung nicht aufhalten.
      try { listener() } catch { /* Weitere Listener trotzdem benachrichtigen. */ }
    }
  }

  function isLogoutPending(): boolean { return pendingLogouts.size > 0 }

  function subscribeLogout(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  function runLogout(operation: () => Promise<void>, intent = 'current'): Promise<void> {
    const pending = pendingLogouts.get(intent)
    if (pending) return pending

    // Erst als laufend merken, dann Listener informieren und den Vorgang starten.
    const result = Promise.resolve().then(() => withLock(operation)).finally(() => {
      if (pendingLogouts.get(intent) === result) {
        pendingLogouts.delete(intent)
        notify()
      }
    })
    pendingLogouts.set(intent, result)
    notify()
    return result
  }

  function runLogoutIfCurrent(
    expectedSessionKey: string,
    getCurrentSessionKey: () => Promise<string | null>,
    operation: () => Promise<void>,
  ): Promise<void> {
    return runLogout(async () => {
      // Nach dem Warten erneut prüfen: Ein anderer Tab könnte schon neu angemeldet sein.
      if (await getCurrentSessionKey() === expectedSessionKey) await operation()
    }, `session:${expectedSessionKey}`)
  }

  async function waitForLogout(): Promise<void> {
    while (pendingLogouts.size) {
      // Fehler meldet die Abmeldung selbst; die nächste Anmeldung wartet nur.
      await Promise.allSettled([...pendingLogouts.values()])
    }
  }

  async function runLogin<T>(operation: () => Promise<T>): Promise<T> {
    await waitForLogout()
    return withLock(operation)
  }

  return { runLogout, runLogoutIfCurrent, waitForLogout, runLogin, isLogoutPending, subscribeLogout }
}

const operations = createAuthOperations()
export const { runLogout, runLogoutIfCurrent, waitForLogout, runLogin, isLogoutPending, subscribeLogout } = operations
