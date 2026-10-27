// Shared request validation. Never put passwords into responses or logs.
export type AdminUserCommand =
  | { action: 'list'; page: number; search: string }
  | {
      action: 'create'
      first_name: string
      last_name: string
      email: string
      password: string
    }
  | { action: 'update'; id: string; first_name: string; last_name: string }
  | { action: 'deactivate'; id: string }

export interface ManagedUser {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: 'admin' | 'device_manager' | 'employee'
  disabled_at: string | null
  login_blocked: boolean
}

export interface UserPage {
  users: ManagedUser[]
  total: number
}

export class AdminUserError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function parseCommand(value: unknown): AdminUserCommand {
  const invalid = () => {
    throw new AdminUserError(
      400,
      'invalid_input',
      'Bitte prüfe die eingegebenen Benutzerdaten.',
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid()
  const input = value as Record<string, unknown>
  const keys: Record<string, string[]> = {
    list: ['action', 'page', 'search'],
    create: ['action', 'first_name', 'last_name', 'email', 'password'],
    update: ['action', 'id', 'first_name', 'last_name'],
    deactivate: ['action', 'id'],
  }
  if (typeof input.action !== 'string' || !Object.hasOwn(keys, input.action))
    return invalid()
  if (
    Object.keys(input).some(
      (key) => !keys[input.action as string].includes(key),
    )
  )
    return invalid()
  if (input.action === 'list') {
    if (
      !Number.isSafeInteger(input.page) ||
      (input.page as number) < 0 ||
      (input.page as number) > 100000 ||
      typeof input.search !== 'string' ||
      input.search.length > 100
    )
      return invalid()
    return {
      action: 'list',
      page: input.page as number,
      search: input.search.trim(),
    }
  }
  const id = input.id
  if (
    input.action !== 'create' &&
    (typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      ))
  )
    return invalid()
  if (input.action === 'deactivate')
    return { action: 'deactivate', id: id as string }
  const name = (field: string) => {
    const text = input[field]
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.trim().length > 100 ||
      /[\u0000-\u001f\u007f]/.test(text)
    )
      return invalid()
    return text.trim()
  }
  const first_name = name('first_name')
  const last_name = name('last_name')
  if (input.action === 'update')
    return { action: 'update', id: id as string, first_name, last_name }
  if (
    typeof input.email !== 'string' ||
    input.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ||
    typeof input.password !== 'string' ||
    input.password.length < 12 ||
    input.password.length > 128
  )
    return invalid()
  return {
    action: 'create',
    first_name,
    last_name,
    email: input.email.trim().toLowerCase(),
    password: input.password,
  }
}
