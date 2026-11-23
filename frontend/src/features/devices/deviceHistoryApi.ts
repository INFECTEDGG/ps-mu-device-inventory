import { supabase } from '../../lib/supabase'

/**
 * Geräte- und Zuweisungshistorie (PBI-12, FA-14).
 * Gelesen wird ausschließlich über den RPC `inventory_device_history`. Der Server prüft
 * Sitzung, Rolle sowie `devices:view_all` und `assignments:view_all` selbst; die Prüfungen
 * hier dienen nur der Benutzerführung und dem Schutz vor unerwarteten Antworten.
 */

/** Serverseitige Obergrenze je Liste; die Gesamtzahlen (`*_total`) sind trotzdem vollständig. */
export const DEVICE_HISTORY_ROW_LIMIT = 200

export interface DeviceHistoryDevice {
  id: string
  asset_tag: string | null
  name: string | null
  device_type: string | null
  manufacture: string | null
  model: string | null
  status: string | null
}

export interface DeviceHistoryAssignment {
  assignment_id: string
  /** `null`, wenn das Mitarbeiterprofil inzwischen gelöscht wurde. */
  employee_id: string | null
  /** Name, sonst E-Mail, sonst „Unbekannt“ (vom Server ermittelt). */
  employee_name: string
  /** Leerer Text, wenn keine E-Mail-Adresse bekannt ist. */
  employee_email: string
  assigned_at: string
  /** `null`, wenn kein ausgebender Benutzer gespeichert ist (Anzeige „System“). */
  assigned_by_name: string | null
  /** `null`, solange die Zuweisung aktiv ist. */
  returned_at: string | null
  /** `null` bei aktiven Zuweisungen oder ohne zurücknehmenden Benutzer. */
  returned_by_name: string | null
  /** `true` genau dann, wenn `returned_at` fehlt. */
  active: boolean
}

export interface DeviceStatusChange {
  id: string
  /** `null` beim ersten protokollierten Status. */
  old_status: string | null
  new_status: string | null
  changed_at: string
  /** `null`, wenn kein ausführender Benutzer gespeichert ist (Anzeige „System“). */
  changed_by_name: string | null
}

export interface DeviceHistory {
  device: DeviceHistoryDevice
  /** Neueste zuerst, höchstens {@link DEVICE_HISTORY_ROW_LIMIT} Einträge. */
  assignments: DeviceHistoryAssignment[]
  assignments_total: number
  /** Neueste zuerst, höchstens {@link DEVICE_HISTORY_ROW_LIMIT} Einträge. */
  status_changes: DeviceStatusChange[]
  status_changes_total: number
}

export type DeviceHistoryErrorCode =
  | 'forbidden'
  | 'missing'
  | 'invalid'
  | 'unauthorized'
  | 'unavailable'
  | 'invalid_response'

export class DeviceHistoryError extends Error {
  constructor(message: string, readonly code: DeviceHistoryErrorCode) {
    super(message)
    this.name = 'DeviceHistoryError'
  }
}

const MESSAGES = {
  forbidden: 'Keine Berechtigung für die Gerätehistorie.',
  missing: 'Das Gerät wurde nicht gefunden.',
  invalid: 'Ungültige Geräteauswahl.',
  unauthorized: 'Bitte melde dich erneut an.',
  unavailable: 'Die Gerätehistorie ist derzeit nicht verfügbar. Bitte die Supabase-Funktionen prüfen.',
  invalid_response: 'Ungültige Antwort der Gerätehistorie empfangen.',
} as const satisfies Record<DeviceHistoryErrorCode, string>

function errorFor(code: DeviceHistoryErrorCode): DeviceHistoryError {
  return new DeviceHistoryError(MESSAGES[code], code)
}

function classify(code?: string): DeviceHistoryError {
  if (code === '42501' || code === 'PGRST301') return errorFor('forbidden')
  if (code === 'P0002') return errorFor('missing')
  if (code === '22023') return errorFor('invalid')
  return errorFor('unavailable')
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(): DeviceHistoryError {
  return errorFor('invalid_response')
}

/** Pflichttext, der nicht leer sein darf (IDs, Zeitstempel). */
function requiredText(record: JsonRecord, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') throw invalidResponse()
  return value
}

/** Text, der vorhanden sein muss, aber leer sein darf. */
function text(record: JsonRecord, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw invalidResponse()
  return value
}

/** Schlüssel muss vorhanden sein; erlaubt sind Text oder `null`. */
function nullableText(record: JsonRecord, key: string): string | null {
  const value = record[key]
  if (value !== null && typeof value !== 'string') throw invalidResponse()
  return value
}

function count(record: JsonRecord, key: string, minimum: number): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw invalidResponse()
  return value
}

function parseDevice(value: unknown): DeviceHistoryDevice {
  if (!isRecord(value)) throw invalidResponse()
  return {
    id: requiredText(value, 'id'),
    asset_tag: nullableText(value, 'asset_tag'),
    name: nullableText(value, 'name'),
    device_type: nullableText(value, 'device_type'),
    manufacture: nullableText(value, 'manufacture'),
    model: nullableText(value, 'model'),
    status: nullableText(value, 'status'),
  }
}

function parseAssignment(value: unknown): DeviceHistoryAssignment {
  if (!isRecord(value) || typeof value.active !== 'boolean') throw invalidResponse()
  const returnedAt = nullableText(value, 'returned_at')
  if (returnedAt !== null && returnedAt.trim() === '') throw invalidResponse()
  // „Aktiv“ und Rückgabezeitpunkt müssen zusammenpassen, sonst wäre die Anzeige widersprüchlich.
  if (value.active !== (returnedAt === null)) throw invalidResponse()
  return {
    assignment_id: requiredText(value, 'assignment_id'),
    employee_id: nullableText(value, 'employee_id'),
    employee_name: text(value, 'employee_name'),
    employee_email: text(value, 'employee_email'),
    assigned_at: requiredText(value, 'assigned_at'),
    assigned_by_name: nullableText(value, 'assigned_by_name'),
    returned_at: returnedAt,
    returned_by_name: nullableText(value, 'returned_by_name'),
    active: value.active,
  }
}

function parseStatusChange(value: unknown): DeviceStatusChange {
  if (!isRecord(value)) throw invalidResponse()
  return {
    id: requiredText(value, 'id'),
    old_status: nullableText(value, 'old_status'),
    new_status: nullableText(value, 'new_status'),
    changed_at: requiredText(value, 'changed_at'),
    changed_by_name: nullableText(value, 'changed_by_name'),
  }
}

/**
 * Prüft die RPC-Antwort streng (Struktur, Typen, Zähler) und übernimmt nur die
 * vereinbarten Schlüssel. Wirft `DeviceHistoryError` mit Code `invalid_response`.
 */
export function parseDeviceHistory(value: unknown): DeviceHistory {
  if (!isRecord(value) || !Array.isArray(value.assignments) || !Array.isArray(value.status_changes)) {
    throw invalidResponse()
  }
  const assignments = value.assignments.map(parseAssignment)
  const statusChanges = value.status_changes.map(parseStatusChange)
  return {
    device: parseDevice(value.device),
    assignments,
    // Die Gesamtzahl kann wegen der Obergrenze größer, aber nie kleiner als die Liste sein.
    assignments_total: count(value, 'assignments_total', assignments.length),
    status_changes: statusChanges,
    status_changes_total: count(value, 'status_changes_total', statusChanges.length),
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireSession() {
  if (!supabase) throw errorFor('unavailable')
  let session: unknown = null
  try {
    const { data, error } = await supabase.auth.getSession()
    if (!error) session = data.session
  } catch {
    session = null
  }
  if (!session) throw errorFor('unauthorized')
  return supabase
}

export const deviceHistoryApi = {
  /**
   * Lädt Zuweisungen und Statusänderungen eines Gerätes (neueste zuerst).
   * Die Geräte-ID wird vor dem Netzwerkaufruf geprüft; eine Antwort zu einem anderen
   * Gerät wird als ungültig verworfen.
   */
  async load(deviceId: string): Promise<DeviceHistory> {
    if (typeof deviceId !== 'string' || !UUID_PATTERN.test(deviceId)) throw errorFor('invalid')
    const db = await requireSession()
    let data: unknown
    try {
      const response = await db.rpc('inventory_device_history', { target_device: deviceId })
      if (response.error) throw classify(response.error.code)
      data = response.data
    } catch (error) {
      if (error instanceof DeviceHistoryError) throw error
      throw errorFor('unavailable')
    }
    const history = parseDeviceHistory(data)
    if (history.device.id.toLowerCase() !== deviceId.toLowerCase()) throw invalidResponse()
    return history
  },
}
