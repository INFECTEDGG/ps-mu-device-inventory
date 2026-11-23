import { hasPermission, type Permission, type Role } from '../../config/permissions'
import { mayViewAuditLog } from '../audit/auditAccess'

/**
 * Regeln der Gerätehistorie (PBI-12, FA-14): Zugriffsregeln als Spiegel der Serverprüfung
 * sowie reine Anzeigeregeln (Dauer, Zähler, ausführender Benutzer). Die maßgebliche
 * Prüfung erfolgt immer serverseitig in `inventory_device_history` bzw. im Audit-RPC.
 */

const HISTORY_ROLES: readonly Role[] = ['device_manager', 'admin', 'super_admin']

/**
 * Gerätehistorie: Gerätemanager, Administratoren und SuperAdmins, die sowohl alle Geräte
 * als auch alle Zuweisungen sehen dürfen (`devices:view_all` UND `assignments:view_all`).
 */
export function mayViewDeviceHistory(
  role: Role | null | undefined,
  permissions?: readonly Permission[] | null,
): boolean {
  return Boolean(role && HISTORY_ROLES.includes(role))
    && hasPermission(role, 'devices:view_all', permissions)
    && hasPermission(role, 'assignments:view_all', permissions)
}

/** Änderungsprotokoll in den Gerätedetails: gleiche Regel wie das Audit-Log (FA-21). */
export function mayViewDeviceAudit(
  role: Role | null | undefined,
  permissions?: readonly Permission[] | null,
): boolean {
  return mayViewAuditLog(role, permissions)
}

const DAY_MS = 24 * 60 * 60 * 1000
const numberFormat = new Intl.NumberFormat('de-DE')

/** Ganzzahl im deutschen Format, z. B. „1.250“. */
export function formatHistoryCount(value: number): string {
  return numberFormat.format(value)
}

/** Zähler mit passender Einzahl/Mehrzahl, z. B. „1 Zuweisung“ oder „3 Zuweisungen“. */
export function countLabel(value: number, singular: string, plural: string): string {
  return `${formatHistoryCount(value)} ${value === 1 ? singular : plural}`
}

/**
 * Hinweis, wenn der Server wegen der Obergrenze nicht alle Einträge liefert,
 * z. B. „200 von 250 Zuweisungen angezeigt (neueste zuerst).“; sonst `null`.
 */
export function historyCapHint(shown: number, total: number, plural: string): string | null {
  if (!(total > shown)) return null
  return `${formatHistoryCount(shown)} von ${formatHistoryCount(total)} ${plural} angezeigt (neueste zuerst).`
}

/** Ausführender Benutzer; ohne gespeicherten Benutzer (z. B. Wartung ohne Sitzung) „System“. */
export function historyActorLabel(name: string | null | undefined): string {
  const value = typeof name === 'string' ? name.trim() : ''
  return value === '' ? 'System' : value
}

function dayLabel(days: number): string {
  if (days < 1) return '< 1 Tag'
  return days === 1 ? '1 Tag' : `${formatHistoryCount(days)} Tage`
}

/**
 * Dauer einer Zuweisung in vollen Tagen, z. B. „3 Tage“ oder „< 1 Tag“.
 * Aktive Zuweisungen (ohne Ende) werden bis `now` gerechnet und mit „bisher“ markiert.
 * Ungültige Zeitstempel oder ein Ende vor dem Beginn ergeben „–“.
 */
export function assignmentDurationLabel(
  assignedAt: string,
  returnedAt: string | null,
  now: Date = new Date(),
): string {
  const start = Date.parse(assignedAt)
  if (!Number.isFinite(start)) return '–'
  if (returnedAt === null) {
    // Eine leicht abweichende Uhr des Browsers darf keine negative Dauer erzeugen.
    const elapsed = Math.max(0, now.getTime() - start)
    return Number.isFinite(elapsed) ? `bisher ${dayLabel(Math.floor(elapsed / DAY_MS))}` : '–'
  }
  const end = Date.parse(returnedAt)
  if (!Number.isFinite(end) || end < start) return '–'
  return dayLabel(Math.floor((end - start) / DAY_MS))
}
