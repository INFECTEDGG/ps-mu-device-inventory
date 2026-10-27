import { AdminUserError, parseCommand } from './contracts.ts'
import type { AdminUserCommand } from './contracts.ts'

interface RpcResult {
  data: unknown
  error: { code?: string } | null
}
export interface AdminDependencies {
  authenticate(token: string): Promise<boolean>
  rpc(
    token: string,
    name: string,
    args?: Record<string, unknown>,
  ): Promise<RpcResult>
  create(
    command: Extract<AdminUserCommand, { action: 'create' }>,
  ): Promise<{ id: string | null; code?: string }>
  ban(id: string): Promise<boolean>
}

function databaseError(error: { code?: string }): never {
  if (error.code === '42501')
    throw new AdminUserError(
      403,
      'forbidden',
      'Keine Berechtigung oder keine aktive Sitzung.',
    )
  if (error.code === 'P0002')
    throw new AdminUserError(404, 'not_found', 'Benutzer nicht gefunden.')
  if (error.code === '22023')
    throw new AdminUserError(
      400,
      'invalid_input',
      'Diese Änderung ist nicht erlaubt.',
    )
  throw new AdminUserError(
    503,
    'unavailable',
    'Die Benutzerverwaltung ist derzeit nicht verfügbar.',
  )
}

export function createAdminHandler(
  deps: AdminDependencies,
  allowedOrigins: string[],
) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin')
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    })
    if (origin && allowedOrigins.includes(origin))
      headers.set('Access-Control-Allow-Origin', origin)
    headers.set(
      'Access-Control-Allow-Headers',
      'authorization, apikey, content-type, x-client-info',
    )
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    const respond = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers })
    if (origin && !allowedOrigins.includes(origin))
      return respond(403, { code: 'forbidden', message: 'Zugriff verweigert.' })
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers })
    if (request.method !== 'POST')
      return respond(405, { code: 'method', message: 'Methode nicht erlaubt.' })
    try {
      const token = /^Bearer (\S+)$/i.exec(
        request.headers.get('Authorization') ?? '',
      )?.[1]
      if (!token || !(await deps.authenticate(token)))
        throw new AdminUserError(401, 'unauthorized', 'Bitte erneut anmelden.')
      const rpc = async (name: string, args?: Record<string, unknown>) => {
        const result = await deps.rpc(token, name, args)
        if (result.error) databaseError(result.error)
        return result.data
      }
      // Live server-side role AND inactivity check; no role is taken from the request.
      await rpc('inventory_admin_check')
      const text = await request.text()
      if (text.length > 4096)
        throw new AdminUserError(
          413,
          'invalid_input',
          'Die Anfrage ist zu groß.',
        )
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        throw new AdminUserError(400, 'invalid_input', 'Ungültige Anfrage.')
      }
      const command = parseCommand(body)
      if (command.action === 'list') {
        return respond(
          200,
          await rpc('inventory_admin_list_users', {
            page_number: command.page,
            search_text: command.search,
          }),
        )
      }
      if (command.action === 'update') {
        await rpc('inventory_admin_update_user', {
          target_id: command.id,
          given_name: command.first_name,
          family_name: command.last_name,
        })
        return respond(200, { ok: true })
      }
      if (command.action === 'deactivate') {
        // Disable DB access and revoke app sessions first. A failed Auth ban can be retried.
        await rpc('inventory_admin_disable_user', { target_id: command.id })
        let banned = false
        try {
          banned = await deps.ban(command.id)
        } catch {
          /* Preserve retryable partial failure. */
        }
        if (!banned) {
          throw new AdminUserError(
            503,
            'ban_pending',
            'Anwendungszugriff gesperrt. Die Anmeldesperre muss erneut ausgeführt werden.',
          )
        }
        return respond(200, { ok: true })
      }
      // Ensure the reviewed atomic Auth->profile trigger is installed BEFORE creating an Auth user.
      await rpc('inventory_admin_creation_ready')
      const created = await deps.create(command)
      if (!created.id) {
        if (
          created.code === 'email_exists' ||
          created.code === 'user_already_exists'
        ) {
          throw new AdminUserError(
            409,
            'email_exists',
            'Diese E-Mail-Adresse wird bereits verwendet.',
          )
        }
        throw new AdminUserError(
          400,
          'creation_failed',
          'Konto konnte nicht angelegt werden. Prüfe E-Mail und Passwortvorgaben.',
        )
      }
      return respond(201, { ok: true, id: created.id })
    } catch (error) {
      const safe =
        error instanceof AdminUserError
          ? error
          : new AdminUserError(
              503,
              'unavailable',
              'Die Benutzerverwaltung ist derzeit nicht verfügbar.',
            )
      return respond(safe.status, { code: safe.code, message: safe.message })
    }
  }
}
