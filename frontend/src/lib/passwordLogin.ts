import { runLogin } from './authOperations.ts'

interface PasswordAuthClient {
  auth: {
    signInWithPassword(credentials: { email: string; password: string }): Promise<{
      data: { session: unknown } | null
      error: unknown
    }>
  }
}

export class PasswordLoginError extends Error {}

export async function loginWithPassword(
  client: PasswordAuthClient | null,
  email: string,
  password: string,
): Promise<void> {
  if (!email.trim() || !password) {
    throw new PasswordLoginError('Bitte gib deine E-Mail-Adresse und dein Passwort ein.')
  }

  if (!client) {
    throw new PasswordLoginError('Die Anmeldung ist derzeit nicht verfügbar. Bitte versuche es später erneut.')
  }

  try {
    // Derselbe Lock wie beim Abmelden verhindert Überschneidungen zwischen Tabs.
    await runLogin(async () => {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error || !data?.session) {
        throw new PasswordLoginError(
          'Die Anmeldung ist fehlgeschlagen. Prüfe deine Zugangsdaten oder versuche es später erneut.',
        )
      }
    })
  } catch (error) {
    if (error instanceof PasswordLoginError) throw error
    throw new PasswordLoginError('Die Verbindung zur Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.')
  }
}
