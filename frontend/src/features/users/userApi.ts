import { supabase } from '../../lib/supabase'
import type {
  AdminUserCommand,
  ManagedUser,
  UserPage,
} from '../../../../supabase/functions/admin-users/contracts'

export type { ManagedUser, UserPage }

export class UserApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

const safeMessages: Record<string, string> = {
  unauthorized: 'Bitte erneut anmelden.',
  forbidden: 'Keine Berechtigung oder keine aktive Sitzung.',
  invalid_input: 'Bitte prüfe deine Eingaben.',
  email_exists: 'Diese E-Mail-Adresse wird bereits verwendet.',
  creation_failed:
    'Konto konnte nicht angelegt werden. Prüfe E-Mail und Passwortvorgaben.',
  not_found: 'Der Benutzer wurde nicht gefunden.',
  ban_pending:
    'Anwendungszugriff gesperrt. Bitte die Anmeldesperre mit „Sperre abschließen“ erneut ausführen.',
}

async function call(command: AdminUserCommand): Promise<unknown> {
  if (!supabase)
    throw new UserApiError('Supabase ist nicht eingerichtet.', 'unavailable')
  const { data: auth, error: authError } = await supabase.auth.getSession()
  if (authError || !auth.session)
    throw new UserApiError(safeMessages.unauthorized, 'unauthorized')
  try {
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: command,
      headers: { Authorization: `Bearer ${auth.session.access_token}` },
    })
    if (error) {
      let code = 'unavailable'
      if (error.context instanceof Response) {
        try {
          const body = await error.context.json()
          if (typeof body?.code === 'string') code = body.code
        } catch {
          /* generic message */
        }
      }
      throw new UserApiError(
        safeMessages[code] ??
          'Die Benutzerverwaltung ist derzeit nicht verfügbar.',
        code,
      )
    }
    return data
  } catch (error) {
    if (error instanceof UserApiError) throw error
    throw new UserApiError(
      'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
      'unavailable',
    )
  }
}

export const userApi = {
  async list(page: number, search: string): Promise<UserPage> {
    const data = await call({ action: 'list', page, search })
    if (!data || typeof data !== 'object')
      throw new UserApiError('Ungültige Serverantwort.', 'invalid_response')
    const result = data as Partial<UserPage>
    if (
      !Array.isArray(result.users) ||
      !Number.isSafeInteger(result.total) ||
      result.total! < 0 ||
      result.users.some(
        (user) =>
          !user ||
          typeof user.id !== 'string' ||
          !['admin', 'device_manager', 'employee'].includes(user.role) ||
          ![
            user.first_name,
            user.last_name,
            user.email,
            user.disabled_at,
          ].every((field) => field === null || typeof field === 'string') ||
          typeof user.login_blocked !== 'boolean',
      )
    )
      throw new UserApiError('Ungültige Serverantwort.', 'invalid_response')
    return result as UserPage
  },
  create(input: {
    first_name: string
    last_name: string
    email: string
    password: string
  }) {
    return call({ ...input, action: 'create' })
  },
  update(id: string, input: { first_name: string; last_name: string }) {
    return call({ action: 'update', id, ...input })
  },
  deactivate(id: string) {
    return call({ action: 'deactivate', id })
  },
}
