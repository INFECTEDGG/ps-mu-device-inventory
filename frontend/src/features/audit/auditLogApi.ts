import { supabase } from '../../lib/supabase'

/**
 * Audit-Log (PBI-15, FA-20/FA-21).
 * Gelesen wird ausschließlich über den RPC `inventory_audit_log_list`; die Tabelle
 * `audit_logs` ist für Browser-Rollen gesperrt. Der Server prüft aktives Konto, Sitzung
 * und `audit:view` selbst – die Prüfungen hier dienen nur der Benutzerführung.
 */

export type AuditEntityType = 'device' | 'user' | 'role'

export const AUDIT_ENTITY_TYPES: readonly AuditEntityType[] = ['device', 'user', 'role']

/** Geschlossene Aktionsliste (Reihenfolge wie in docs/pbi-15-audit-log.md, „Protokollierte Aktionen“). */
export const AUDIT_ACTIONS = [
  'DEVICE_CREATED',
  'DEVICE_UPDATED',
  'DEVICE_STATUS_CHANGED',
  'DEVICE_DELETED',
  'DEVICE_ASSIGNED',
  'DEVICE_RETURNED',
  'ASSIGNMENT_UPDATED',
  'ASSIGNMENT_DELETED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ROLE_CHANGED',
  'USER_DISABLED',
  'USER_ENABLED',
  'USER_DELETED',
  'ROLE_PERMISSIONS_CHANGED',
] as const

export type AuditAction = typeof AUDIT_ACTIONS[number]

/**
 * Ein Eintrag mit exakt den Schlüsseln der RPC-Antwort. `action` und `entity_type`
 * bleiben bewusst `string`: Ältere Einträge (z. B. aus früheren Migrationen) dürfen
 * angezeigt werden, auch wenn sie nicht zur aktuellen Aktionsliste gehören.
 */
export interface AuditLogEntry {
  id: string
  created_at: string
  action: string
  entity_type: string
  entity_id: string | null
  entity_title: string | null
  user_id: string | null
  user_name: string | null
  user_email: string | null
  details: Record<string, unknown>
}

export interface AuditLogPage {
  total: number
  page_size: number
  items: AuditLogEntry[]
}

/** Filterwerte aus dem Formular; `from`/`to` im Format `yyyy-mm-dd` (lokale Zeit, `to` inklusive). */
export interface AuditLogFilters {
  action: AuditAction | ''
  entityType: AuditEntityType | ''
  search: string
  from: string
  to: string
}

export const EMPTY_AUDIT_FILTERS: Readonly<AuditLogFilters> = Object.freeze({
  action: '',
  entityType: '',
  search: '',
  from: '',
  to: '',
})

export const AUDIT_PAGE_SIZE = 25
export const AUDIT_SEARCH_MAX_LENGTH = 100
/** Serverseitige Obergrenze für `target_page`. */
export const AUDIT_MAX_PAGE = 10000

export type AuditLogErrorCode =
  | 'forbidden'
  | 'invalid'
  | 'unauthorized'
  | 'unavailable'
  | 'invalid_response'

export class AuditLogError extends Error {
  constructor(
    message: string,
    readonly code: AuditLogErrorCode,
    /** Betroffenes Filterfeld bei Eingabefehlern, damit die Oberfläche es markieren kann. */
    readonly field?: keyof AuditLogFilters,
  ) {
    super(message)
    this.name = 'AuditLogError'
  }
}

const MESSAGES = {
  forbidden: 'Keine Berechtigung für das Audit-Log.',
  invalid: 'Ungültige Filterauswahl.',
  unauthorized: 'Bitte melde dich erneut an.',
  unavailable: 'Das Audit-Log ist derzeit nicht verfügbar. Bitte die Supabase-Funktionen prüfen.',
  invalid_response: 'Ungültige Antwort des Audit-Logs empfangen.',
} as const satisfies Record<AuditLogErrorCode, string>

function errorFor(code?: string): AuditLogError {
  if (code === '42501' || code === 'PGRST301') return new AuditLogError(MESSAGES.forbidden, 'forbidden')
  if (code === '22023') return new AuditLogError(MESSAGES.invalid, 'invalid')
  return new AuditLogError(MESSAGES.unavailable, 'unavailable')
}

function invalid(message: string, field?: keyof AuditLogFilters): AuditLogError {
  return new AuditLogError(message, 'invalid', field)
}

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(value)
}

export function isAuditEntityType(value: unknown): value is AuditEntityType {
  return typeof value === 'string' && (AUDIT_ENTITY_TYPES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/**
 * Details sind freies JSON. Ein fehlendes Objekt wird zu `{}`; ein unerwarteter
 * Nicht-Objekt-Wert (Altdaten) bleibt unter `value` erhalten statt verworfen zu werden.
 */
function normalizeDetails(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (isRecord(value)) return value
  return { value }
}

function parseEntry(value: unknown): AuditLogEntry {
  if (!isRecord(value) ||
      typeof value.id !== 'string' || value.id === '' ||
      typeof value.created_at !== 'string' || value.created_at === '' ||
      typeof value.action !== 'string' || value.action === '' ||
      typeof value.entity_type !== 'string' ||
      !isNullableString(value.entity_id) ||
      !isNullableString(value.entity_title) ||
      !isNullableString(value.user_id) ||
      !isNullableString(value.user_name) ||
      !isNullableString(value.user_email)) {
    throw new AuditLogError('Ungültige Audit-Einträge empfangen.', 'invalid_response')
  }
  return {
    id: value.id,
    created_at: value.created_at,
    action: value.action,
    entity_type: value.entity_type,
    entity_id: value.entity_id,
    entity_title: value.entity_title,
    user_id: value.user_id,
    user_name: value.user_name,
    user_email: value.user_email,
    details: normalizeDetails(value.details),
  }
}

/** Prüft die RPC-Antwort streng (Struktur, Zähler, Pflichtfelder) und normalisiert die Einträge. */
export function parseAuditLogPage(value: unknown): AuditLogPage {
  if (!isRecord(value) || !Array.isArray(value.items) ||
      !Number.isSafeInteger(value.total) || (value.total as number) < 0 ||
      !Number.isSafeInteger(value.page_size) || (value.page_size as number) <= 0 ||
      value.items.length > (value.page_size as number)) {
    throw new AuditLogError(MESSAGES.invalid_response, 'invalid_response')
  }
  return {
    total: value.total as number,
    page_size: value.page_size as number,
    items: value.items.map(parseEntry),
  }
}

export interface AuditRpcArgs {
  target_page: number
  target_action: AuditAction | null
  target_entity_type: AuditEntityType | null
  target_entity_id: string | null
  search_text: string | null
  created_from: string | null
  created_to: string | null
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Wandelt `yyyy-mm-dd` in einen Zeitpunkt in lokaler Zeit um (Tagesbeginn bzw. Tagesende).
 * Ungültige Kalenderdaten (z. B. 2026-02-30) werden abgelehnt.
 */
function localDayBoundary(value: string, boundary: 'start' | 'end'): Date | null {
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null
  // setFullYear statt Konstruktor, damit zweistellige Jahre nicht als 19xx gedeutet werden.
  const date = new Date(2000, 0, 1, 0, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  if (boundary === 'end') date.setHours(23, 59, 59, 999)
  else date.setHours(0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Zeichenanzahl in Unicode-Codepoints, wie `char_length` in PostgreSQL. */
function codePointLength(value: string): number {
  return Array.from(value).length
}

/**
 * Baut die RPC-Argumente aus den Formularfiltern (rein, ohne Netzwerkzugriff).
 * - leere Felder werden zu `null` (kein Filter)
 * - die Suche wird getrimmt; leer = keine Suche, mehr als 100 Zeichen = Fehler
 * - `from` = Tagesbeginn, `to` = Tagesende (inklusive, bis zur letzten Mikrosekunde) in lokaler Zeit
 * Ungültige Eingaben werfen `AuditLogError` mit Code `invalid`.
 */
export function buildAuditRpcArgs(filters: AuditLogFilters, page: number): AuditRpcArgs {
  if (!Number.isSafeInteger(page) || page < 0 || page > AUDIT_MAX_PAGE) {
    throw invalid('Ungültige Seitenangabe.')
  }
  if (filters.action !== '' && !isAuditAction(filters.action)) {
    throw invalid('Unbekannte Aktion ausgewählt.', 'action')
  }
  if (filters.entityType !== '' && !isAuditEntityType(filters.entityType)) {
    throw invalid('Unbekannter Objekttyp ausgewählt.', 'entityType')
  }

  const entityType: AuditEntityType | null = filters.entityType === '' ? null : filters.entityType

  const search = typeof filters.search === 'string' ? filters.search.trim() : ''
  if (codePointLength(search) > AUDIT_SEARCH_MAX_LENGTH) {
    throw invalid(`Der Suchbegriff darf höchstens ${AUDIT_SEARCH_MAX_LENGTH} Zeichen lang sein.`, 'search')
  }

  const fromValue = typeof filters.from === 'string' ? filters.from.trim() : ''
  const toValue = typeof filters.to === 'string' ? filters.to.trim() : ''
  const from = fromValue === '' ? null : localDayBoundary(fromValue, 'start')
  if (fromValue !== '' && from === null) {
    throw invalid('Bitte ein gültiges Datum im Feld „Von“ angeben.', 'from')
  }
  const to = toValue === '' ? null : localDayBoundary(toValue, 'end')
  if (toValue !== '' && to === null) {
    throw invalid('Bitte ein gültiges Datum im Feld „Bis“ angeben.', 'to')
  }
  if (from !== null && to !== null && from.getTime() > to.getTime()) {
    throw invalid('Das Startdatum darf nicht nach dem Enddatum liegen.', 'from')
  }

  return {
    target_page: page,
    target_action: filters.action === '' ? null : filters.action,
    target_entity_type: entityType,
    target_entity_id: null,
    search_text: search === '' ? null : search,
    created_from: from === null ? null : from.toISOString(),
    // PostgreSQL speichert Mikrosekunden: .999 → .999999, damit wirklich der ganze Tag enthalten ist.
    created_to: to === null ? null : to.toISOString().replace(/\.(\d{3})Z$/, '.$1999Z'),
  }
}

async function requireSession() {
  if (!supabase) throw errorFor()
  let session: unknown = null
  try {
    const { data, error } = await supabase.auth.getSession()
    if (!error) session = data.session
  } catch {
    session = null
  }
  if (!session) throw new AuditLogError(MESSAGES.unauthorized, 'unauthorized')
  return supabase
}

export const auditLogApi = {
  /** Lädt eine Seite des Audit-Logs. Eingaben werden vor dem Netzwerkaufruf geprüft. */
  async list(filters: AuditLogFilters, page: number): Promise<AuditLogPage> {
    const args = buildAuditRpcArgs(filters, page)
    const db = await requireSession()
    let data: unknown
    try {
      const response = await db.rpc('inventory_audit_log_list', { ...args })
      if (response.error) throw errorFor(response.error.code)
      data = response.data
    } catch (error) {
      if (error instanceof AuditLogError) throw error
      throw errorFor()
    }
    return parseAuditLogPage(data)
  },
}
