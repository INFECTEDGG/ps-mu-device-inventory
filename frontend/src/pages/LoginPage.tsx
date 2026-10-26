import { useState, type SubmitEvent } from 'react'
import { logout } from '../lib/logout'
import { loginWithPassword, PasswordLoginError } from '../lib/passwordLogin'
import { supabase } from '../lib/supabase'
import { useAuthSession } from '../hooks/useAuthSession'

export function LoginPage() {
  const { session, isLoading, isSigningOut, sessionNotice, clearSessionNotice } = useAuthSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasError, setHasError] = useState(false)
  const isBusy = isSubmitting || isSigningOut
  const feedback = sessionNotice ?? message
  const feedbackHasError = sessionNotice ? false : hasError

  async function handleLogout() {
    if (isBusy) return

    setIsSubmitting(true)
    setHasError(false)
    setMessage('')

    try {
      await logout()
      setEmail('')
      setPassword('')
      setMessage('Du wurdest abgemeldet.')
    } catch {
      setHasError(true)
      setMessage('Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isBusy) return

    clearSessionNotice()
    setMessage('')
    setHasError(false)
    setIsSubmitting(true)

    try {
      await loginWithPassword(supabase, email, password)
      setPassword('')
      setMessage('Du bist erfolgreich angemeldet.')
    } catch (error) {
      setHasError(true)
      setMessage(error instanceof PasswordLoginError
        ? error.message
        : 'Die Anmeldung ist fehlgeschlagen. Bitte versuche es später erneut.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="page-title" className="login-card">
        <h1 id="page-title" tabIndex={-1}>Device Inventory</h1>
        <p role="status">
          {isLoading
            ? 'Sitzung wird geprüft …'
            : session
              ? 'Du bist angemeldet.'
              : 'Melde dich mit deinen Zugangsdaten an.'}
        </p>

        <form
          aria-busy={isBusy}
          aria-describedby={feedback ? 'login-message' : undefined}
          onSubmit={handleSubmit}
        >
          {!session && (
            <>
              <div>
                <label htmlFor="login-email">E-Mail-Adresse</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={isBusy}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="login-password">Passwort</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  disabled={isBusy}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
            </>
          )}
          {session ? (
            <button
              disabled={isBusy}
              onClick={handleLogout}
              type="button"
            >
              {isBusy ? 'Abmeldung läuft …' : 'Abmelden'}
            </button>
          ) : (
            <button disabled={isBusy} type="submit">
              {isSigningOut ? 'Abmeldung läuft …' : isSubmitting ? 'Anmeldung läuft …' : 'Anmelden'}
            </button>
          )}

          {session && <a className="auth-link" href="/">Zur Anwendung</a>}

          {feedback && (
            <p
              className={`login-message login-message--${feedbackHasError ? 'error' : 'success'}`}
              id="login-message"
              role={feedbackHasError ? 'alert' : 'status'}
            >
              {feedback}
            </p>
          )}
        </form>
      </section>
    </main>
  )
}
