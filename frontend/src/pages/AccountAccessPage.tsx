import { useState } from 'react'
import { logout } from '../lib/logout'

interface AccountAccessPageProps {
  message: string
  onRetry: () => void
}

export function AccountAccessPage({ message, onRetry }: AccountAccessPageProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [error, setError] = useState('')

  async function handleLogout() {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    setError('')
    try {
      await logout()
    } catch {
      setError('Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.')
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="page-title" className="login-card">
        <h1 id="page-title" tabIndex={-1}>Zugriff noch nicht möglich</h1>
        <p role="alert">{message}</p>
        <div className="auth-actions">
          <button disabled={isLoggingOut} onClick={onRetry} type="button">Erneut prüfen</button>
          <button disabled={isLoggingOut} onClick={handleLogout} type="button">
            {isLoggingOut ? 'Abmeldung läuft …' : 'Abmelden'}
          </button>
        </div>
        {error && <p className="login-message login-message--error" role="alert">{error}</p>}
      </section>
    </main>
  )
}
