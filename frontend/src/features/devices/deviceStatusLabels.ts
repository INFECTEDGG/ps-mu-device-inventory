import type { DeviceStatus } from './deviceApi'

/** Deutsche Anzeigenamen der Gerätestatus; genutzt vom Audit-Log (auditLogFormat). */
export const deviceStatusLabels: Record<DeviceStatus, string> = {
  available: 'Verfügbar',
  assigned: 'Zugewiesen',
  defective: 'Defekt',
  maintenance: 'Wartung',
  retired: 'Ausgemustert',
}

/**
 * Liefert den Anzeigenamen eines Status. Fehlender Status wird als „Nicht gesetzt“
 * angezeigt; unbekannte Werte (z. B. aus Altdaten) bleiben unverändert sichtbar.
 */
export function deviceStatusLabel(status: string | null | undefined): string {
  if (status === null || status === undefined || status.trim() === '') return 'Nicht gesetzt'
  return Object.hasOwn(deviceStatusLabels, status)
    ? deviceStatusLabels[status as DeviceStatus]
    : status
}
