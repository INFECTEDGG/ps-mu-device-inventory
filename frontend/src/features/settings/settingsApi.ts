import { supabase } from '../../lib/supabase'

export interface OwnProfile {
  first_name: string | null
  last_name: string | null
}

export class SettingsApiError extends Error {
  constructor(message: string) { super(message) }
}

export function passwordValidationError(password: string, confirmation: string): string | null {
  if (password.length < 12) return 'Das neue Passwort muss mindestens 12 Zeichen enthalten.'
  if (password.length > 128) return 'Das neue Passwort darf höchstens 128 Zeichen enthalten.'
  if (password !== confirmation) return 'Die beiden Passwörter stimmen nicht überein.'
  return null
}

async function authenticatedClient() {
  if (!supabase) throw new SettingsApiError('Die Kontoeinstellungen sind derzeit nicht verfügbar.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new SettingsApiError('Bitte melde dich erneut an.')
  return { client: supabase, userId: data.session.user.id }
}

export const settingsApi = {
  async ownProfile(): Promise<OwnProfile> {
    const { client, userId } = await authenticatedClient()
    const { data, error } = await client.from('profiles')
      .select('first_name,last_name').eq('id', userId).maybeSingle()
    if (error || !data) throw new SettingsApiError('Dein Benutzerprofil konnte nicht geladen werden.')
    return { first_name: data.first_name, last_name: data.last_name }
  },
  async updatePassword(password: string, confirmation: string): Promise<void> {
    const validation = passwordValidationError(password, confirmation)
    if (validation) throw new SettingsApiError(validation)
    const { client } = await authenticatedClient()
    const { error } = await client.auth.updateUser({ password })
    if (error) {
      throw new SettingsApiError('Passwort konnte nicht geändert werden. Prüfe die Passwortregeln oder melde dich erneut an, falls eine Bestätigung erforderlich ist.')
    }
  },
}
