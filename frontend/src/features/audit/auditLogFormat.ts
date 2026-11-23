import { isPermission, permissionLabels, type Role } from '../../config/permissions'
import { deviceStatusLabel } from '../devices/deviceStatusLabels'
import type { AuditAction, AuditEntityType, AuditLogEntry } from './auditLogApi'

/**
 * Anzeigeformatierung für das Audit-Log. Alle Funktionen sind rein und werfen nie:
 * Altdaten oder unerwartete Detailformen werden lesbar dargestellt statt verworfen.
 */

const EMPTY = '–'
const MAX_TEXT_LENGTH = 200
const MAX_DETAIL_LINES = 12

export const auditActionLabels: Readonly<Record<AuditAction, string>> = {
  DEVICE_CREATED: 'Gerät angelegt',
  DEVICE_UPDATED: 'Gerätedaten geändert',
  DEVICE_STATUS_CHANGED: 'Gerätestatus geändert',
  DEVICE_DELETED: 'Gerät gelöscht',
  DEVICE_ASSIGNED: 'Gerät zugewiesen',
  DEVICE_RETURNED: 'Gerät zurückgenommen',
  ASSIGNMENT_UPDATED: 'Zuweisung korrigiert',
  ASSIGNMENT_DELETED: 'Zuweisung gelöscht',
  USER_CREATED: 'Benutzer angelegt',
  USER_UPDATED: 'Benutzerdaten geändert',
  USER_ROLE_CHANGED: 'Benutzerrolle geändert',
  USER_DISABLED: 'Benutzer deaktiviert',
  USER_ENABLED: 'Benutzer reaktiviert',
  USER_DELETED: 'Benutzer gelöscht',
  ROLE_PERMISSIONS_CHANGED: 'Rollenberechtigungen geändert',
}

export const auditEntityLabels: Readonly<Record<AuditEntityType, string>> = {
  device: 'Gerät',
  user: 'Benutzer',
  role: 'Rolle',
}

/** Gruppierung für die Aktionsauswahl im Filterformular. */
export const AUDIT_ACTION_GROUPS: readonly { label: string; actions: readonly AuditAction[] }[] = [
  { label: 'Geräte', actions: ['DEVICE_CREATED', 'DEVICE_UPDATED', 'DEVICE_STATUS_CHANGED', 'DEVICE_DELETED'] },
  { label: 'Zuweisungen', actions: ['DEVICE_ASSIGNED', 'DEVICE_RETURNED', 'ASSIGNMENT_UPDATED', 'ASSIGNMENT_DELETED'] },
  {
    label: 'Benutzer',
    actions: ['USER_CREATED', 'USER_UPDATED', 'USER_ROLE_CHANGED', 'USER_DISABLED', 'USER_ENABLED', 'USER_DELETED'],
  },
  { label: 'Rollen', actions: ['ROLE_PERMISSIONS_CHANGED'] },
]

const roleLabels: Readonly<Record<Role, string>> = {
  super_admin: 'SuperAdmin',
  admin: 'Administrator',
  device_manager: 'Gerätemanager',
  employee: 'Mitarbeiter',
}

/** Feldnamen der Geräte-, Profil- und Zuweisungsspalten; die Reihenfolge bestimmt die Anzeige. */
const fieldLabels: Readonly<Record<string, string>> = {
  // Geräte
  asset_tag: 'Geräte-ID',
  name: 'Name',
  device_type: 'Gerätetyp',
  manufacture: 'Hersteller',
  model: 'Modell',
  serial_number: 'Seriennummer',
  status: 'Status',
  operating_system: 'Betriebssystem',
  processor: 'Prozessor',
  ram_gb: 'RAM (GB)',
  disk_space_gb: 'Speicherplatz (GB)',
  location: 'Standort',
  device_usage: 'Verwendung',
  purchased_at: 'Kaufdatum',
  start_of_use: 'Nutzungsbeginn',
  maintenance_end: 'Wartungsende',
  description: 'Beschreibung',
  comments: 'Kommentare',
  created_by: 'Angelegt von (ID)',
  // Benutzerprofile
  first_name: 'Vorname',
  last_name: 'Nachname',
  email: 'E-Mail',
  role: 'Rolle',
  role_id: 'Rollen-ID',
  disabled_at: 'Deaktiviert am',
  // Zuweisungen
  employee_name: 'Mitarbeiter',
  employee_id: 'Mitarbeiter-ID',
  assigned_at: 'Zugewiesen am',
  assigned_by: 'Ausgegeben von (ID)',
  returned_at: 'Zurückgegeben am',
  returned_by: 'Zurückgenommen von (ID)',
  assignment_id: 'Zuweisungs-ID',
  device_id: 'Interne Geräte-ID',
  // Sonstige Detailschlüssel
  old_status: 'Alter Status',
  new_status: 'Neuer Status',
  old_role: 'Alte Rolle',
  new_role: 'Neue Rolle',
  permissions: 'Berechtigungen',
  changes: 'Änderungen',
  value: 'Wert',
  id: 'ID',
  created_at: 'Angelegt am',
  updated_at: 'Geändert am',
}

const fieldOrder = Object.keys(fieldLabels)
const STATUS_KEYS = new Set(['status', 'old_status', 'new_status'])
const ROLE_KEYS = new Set(['role', 'old_role', 'new_role'])
const TIMESTAMP_KEYS = new Set(['assigned_at', 'returned_at', 'disabled_at', 'created_at', 'updated_at'])
const DATE_KEYS = new Set(['purchased_at', 'start_of_use', 'maintenance_end'])
const DEVICE_KEY_FIELDS = ['device_type', 'manufacture', 'model', 'serial_number', 'status'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function truncate(value: string): string {
  const characters = Array.from(value)
  return characters.length > MAX_TEXT_LENGTH ? `${characters.slice(0, MAX_TEXT_LENGTH - 1).join('')}…` : value
}

function has(details: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(details, key)
}

export function auditActionLabel(action: string | null | undefined): string {
  const value = text(action)
  if (value === null) return 'Unbekannte Aktion'
  return Object.hasOwn(auditActionLabels, value) ? auditActionLabels[value as AuditAction] : value
}

export function auditEntityLabel(entityType: string | null | undefined): string {
  const value = text(entityType)
  if (value === null) return EMPTY
  return Object.hasOwn(auditEntityLabels, value) ? auditEntityLabels[value as AuditEntityType] : value
}

export function auditRoleLabel(role: unknown): string {
  const value = text(role)
  if (value === null) return 'Keine Rolle'
  return Object.hasOwn(roleLabels, value) ? roleLabels[value as Role] : value
}

export function auditFieldLabel(key: string): string {
  return Object.hasOwn(fieldLabels, key) ? fieldLabels[key] : key
}

/** Ausführender Benutzer: Name, sonst E-Mail, sonst „System“ (z. B. Wartung ohne Benutzersitzung). */
export function auditActorLabel(entry: Pick<AuditLogEntry, 'user_name' | 'user_email'>): string {
  return text(entry?.user_name) ?? text(entry?.user_email) ?? 'System'
}

/** Bezeichnung des betroffenen Objekts; Rollen werden mit ihrem deutschen Namen angezeigt. */
export function auditEntityTitle(entry: Pick<AuditLogEntry, 'entity_type' | 'entity_title'>): string {
  const title = text(entry?.entity_title)
  if (title === null) return EMPTY
  return entry.entity_type === 'role' ? auditRoleLabel(title) : title
}

/** Zeitpunkt im deutschen Format (Datum und Uhrzeit mit Sekunden); ungültige Werte werden zu „–“. */
export function formatAuditTimestamp(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso.trim() === '') return EMPTY
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return EMPTY
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

/** Reine Kalenderdaten (`yyyy-mm-dd`) ohne Zeitzonenumrechnung als `dd.mm.yyyy`. */
function formatDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return '[nicht darstellbar]'
  }
}

function formatPermissions(value: readonly unknown[]): string {
  if (value.length === 0) return 'keine'
  return value
    .map(item => (isPermission(item) ? permissionLabels[item] : formatValue('', item)))
    .join(', ')
}

function formatValue(key: string, value: unknown): string {
  if (STATUS_KEYS.has(key) && (value === null || value === undefined || typeof value === 'string')) {
    return deviceStatusLabel(value)
  }
  if (ROLE_KEYS.has(key) && (value === null || value === undefined || typeof value === 'string')) {
    return auditRoleLabel(value)
  }
  if (value === null || value === undefined) return EMPTY
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return EMPTY
    if (TIMESTAMP_KEYS.has(key)) {
      const formatted = formatAuditTimestamp(trimmed)
      return formatted === EMPTY ? truncate(trimmed) : formatted
    }
    if (DATE_KEYS.has(key)) return formatDateOnly(trimmed)
    return truncate(trimmed)
  }
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein'
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Intl.NumberFormat('de-DE').format(value) : String(value)
  }
  if (Array.isArray(value)) {
    // Berechtigungslisten nicht kürzen: Für die Nachvollziehbarkeit zählt jede einzelne Berechtigung.
    if (key === 'permissions') return formatPermissions(value)
    return value.length === 0 ? EMPTY : truncate(value.map(item => formatValue('', item)).join(', '))
  }
  if (typeof value === 'object') return truncate(safeJson(value))
  return truncate(String(value))
}

function sortKeys(keys: string[]): string[] {
  const rank = (key: string) => {
    const index = fieldOrder.indexOf(key)
    return index === -1 ? fieldOrder.length : index
  }
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'de'))
}

function line(key: string, value: unknown): string {
  return `${auditFieldLabel(key)}: ${formatValue(key, value)}`
}

function describeChanges(changes: unknown): string[] {
  if (!isRecord(changes)) return []
  return sortKeys(Object.keys(changes)).map(key => {
    const change = changes[key]
    if (isRecord(change) && (has(change, 'old') || has(change, 'new'))) {
      return `${auditFieldLabel(key)}: ${formatValue(key, change.old)} → ${formatValue(key, change.new)}`
    }
    return line(key, change)
  })
}

function describeGeneric(details: Record<string, unknown>): string[] {
  return sortKeys(Object.keys(details)).flatMap(key =>
    key === 'changes' && isRecord(details.changes) ? describeChanges(details.changes) : [line(key, details[key])],
  )
}

function employeeLine(details: Record<string, unknown>): string[] {
  if (!has(details, 'employee_name') && !has(details, 'employee_id')) return []
  return [`Mitarbeiter: ${truncate(text(details.employee_name) ?? 'Unbekannt')}`]
}

function optionalLines(details: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter(key => has(details, key)).map(key => line(key, details[key]))
}

function describeDeviceSnapshot(details: Record<string, unknown>): string[] {
  return DEVICE_KEY_FIELDS
    .filter(key => has(details, key) && (key === 'status' || text(details[key]) !== null || typeof details[key] === 'number'))
    .map(key => line(key, details[key]))
}

function describeUserSnapshot(details: Record<string, unknown>): string[] {
  const lines: string[] = []
  const name = [text(details.first_name), text(details.last_name)].filter(Boolean).join(' ')
  if (name !== '') lines.push(`Name: ${truncate(name)}`)
  if (text(details.email) !== null) lines.push(line('email', details.email))
  if (has(details, 'role')) lines.push(line('role', details.role))
  return lines
}

function describeKnownAction(action: string, details: Record<string, unknown>): string[] {
  switch (action) {
    case 'DEVICE_STATUS_CHANGED':
      return has(details, 'old_status') || has(details, 'new_status')
        ? [`Status: ${formatValue('status', details.old_status)} → ${formatValue('status', details.new_status)}`]
        : []
    case 'DEVICE_UPDATED':
    case 'USER_UPDATED':
    case 'ASSIGNMENT_UPDATED':
      return describeChanges(details.changes)
    case 'DEVICE_CREATED':
    case 'DEVICE_DELETED':
      return describeDeviceSnapshot(details)
    case 'DEVICE_ASSIGNED':
      return employeeLine(details)
    case 'DEVICE_RETURNED':
    case 'ASSIGNMENT_DELETED':
      return [...employeeLine(details), ...optionalLines(details, ['assigned_at', 'returned_at'])]
    case 'USER_CREATED':
    case 'USER_DELETED':
      return describeUserSnapshot(details)
    case 'USER_ROLE_CHANGED':
      return has(details, 'old_role') || has(details, 'new_role')
        ? [`Rolle: ${formatValue('role', details.old_role)} → ${formatValue('role', details.new_role)}`]
        : []
    case 'USER_DISABLED':
      return optionalLines(details, ['disabled_at'])
    case 'USER_ENABLED':
      return []
    case 'ROLE_PERMISSIONS_CHANGED': {
      const lines = has(details, 'role') ? [line('role', details.role)] : []
      if (Array.isArray(details.permissions)) lines.push(line('permissions', details.permissions))
      return lines
    }
    default:
      return describeGeneric(details)
  }
}

function limitLines(lines: string[]): string[] {
  if (lines.length <= MAX_DETAIL_LINES) return lines
  const hidden = lines.length - (MAX_DETAIL_LINES - 1)
  return [...lines.slice(0, MAX_DETAIL_LINES - 1), `… und ${hidden} weitere Angaben`]
}

/**
 * Lesbare deutsche Detailzeilen zu einem Eintrag, z. B. „Status: Verfügbar → Zugewiesen“.
 * Bekannte Aktionen werden gezielt aufbereitet; passt die Form nicht, werden alle
 * vorhandenen Angaben generisch angezeigt. Wirft nie.
 */
export function describeAuditDetails(entry: Pick<AuditLogEntry, 'action' | 'details'>): string[] {
  try {
    const details = isRecord(entry?.details) ? entry.details : {}
    const action = typeof entry?.action === 'string' ? entry.action : ''
    const curated = describeKnownAction(action, details)
    const lines = curated.length === 0 && Object.keys(details).length > 0 ? describeGeneric(details) : curated
    return limitLines(lines)
  } catch {
    return []
  }
}
