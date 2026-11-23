import { describe, expect, it } from 'vitest'
import type { Permission } from '../../config/permissions'
import {
  assignmentDurationLabel,
  countLabel,
  historyActorLabel,
  historyCapHint,
  mayViewDeviceAudit,
  mayViewDeviceHistory,
} from './deviceHistoryRules'

const both: Permission[] = ['devices:view_all', 'assignments:view_all']

describe('Gerätehistorie – Zugriffsregeln', () => {
  it('erlaubt Gerätemanagern, Administratoren und SuperAdmins mit Standardrechten die Historie', () => {
    expect(mayViewDeviceHistory('device_manager')).toBe(true)
    expect(mayViewDeviceHistory('admin')).toBe(true)
    expect(mayViewDeviceHistory('super_admin')).toBe(true)
  })

  it('verweigert Mitarbeitern und Benutzern ohne Rolle die Historie', () => {
    expect(mayViewDeviceHistory('employee')).toBe(false)
    expect(mayViewDeviceHistory('employee', both)).toBe(false)
    expect(mayViewDeviceHistory(null, both)).toBe(false)
    expect(mayViewDeviceHistory(undefined)).toBe(false)
  })

  it('verlangt devices:view_all UND assignments:view_all aus den geladenen Berechtigungen', () => {
    expect(mayViewDeviceHistory('device_manager', both)).toBe(true)
    expect(mayViewDeviceHistory('device_manager', ['devices:view_all'])).toBe(false)
    expect(mayViewDeviceHistory('device_manager', ['assignments:view_all'])).toBe(false)
    expect(mayViewDeviceHistory('admin', ['devices:view_all', 'assignments:manage'])).toBe(false)
    expect(mayViewDeviceHistory('super_admin', [])).toBe(false)
  })

  it('zeigt das Änderungsprotokoll nur Administratoren und SuperAdmins mit audit:view', () => {
    expect(mayViewDeviceAudit('admin')).toBe(true)
    expect(mayViewDeviceAudit('super_admin')).toBe(true)
    expect(mayViewDeviceAudit('device_manager')).toBe(false)
    expect(mayViewDeviceAudit('device_manager', ['audit:view', ...both])).toBe(false)
    expect(mayViewDeviceAudit('employee', ['audit:view'])).toBe(false)
    expect(mayViewDeviceAudit('admin', both)).toBe(false)
    expect(mayViewDeviceAudit('admin', ['audit:view'])).toBe(true)
    expect(mayViewDeviceAudit(null)).toBe(false)
  })
})

describe('Gerätehistorie – Anzeigeregeln', () => {
  const start = '2026-11-01T08:00:00Z'

  it('berechnet die Dauer abgeschlossener Zuweisungen in vollen Tagen', () => {
    expect(assignmentDurationLabel(start, '2026-11-01T20:00:00Z')).toBe('< 1 Tag')
    expect(assignmentDurationLabel(start, start)).toBe('< 1 Tag')
    expect(assignmentDurationLabel(start, '2026-11-02T08:00:00Z')).toBe('1 Tag')
    expect(assignmentDurationLabel(start, '2026-11-04T07:59:59Z')).toBe('2 Tage')
    expect(assignmentDurationLabel(start, '2026-11-04T09:30:00.123456+00:00')).toBe('3 Tage')
    expect(assignmentDurationLabel('2023-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe('1.096 Tage')
  })

  it('rechnet aktive Zuweisungen bis jetzt und kennzeichnet sie mit „bisher“', () => {
    const now = new Date('2026-11-06T09:00:00Z')
    expect(assignmentDurationLabel(start, null, now)).toBe('bisher 5 Tage')
    expect(assignmentDurationLabel('2026-11-06T08:00:00Z', null, now)).toBe('bisher < 1 Tag')
    // Browseruhr geht nach: keine negative Dauer.
    expect(assignmentDurationLabel('2026-11-06T10:00:00Z', null, now)).toBe('bisher < 1 Tag')
  })

  it('zeigt bei ungültigen Zeitangaben einen Strich statt einer falschen Dauer', () => {
    expect(assignmentDurationLabel('kein Datum', '2026-11-02T08:00:00Z')).toBe('–')
    expect(assignmentDurationLabel(start, 'kein Datum')).toBe('–')
    expect(assignmentDurationLabel('2026-11-02T08:00:00Z', start)).toBe('–')
    expect(assignmentDurationLabel(start, null, new Date(Number.NaN))).toBe('–')
  })

  it('zeigt „System“, wenn kein ausführender Benutzer gespeichert ist', () => {
    expect(historyActorLabel('  Max Manager ')).toBe('Max Manager')
    expect(historyActorLabel(null)).toBe('System')
    expect(historyActorLabel(undefined)).toBe('System')
    expect(historyActorLabel('   ')).toBe('System')
  })

  it('formuliert Zähler mit Einzahl und Mehrzahl', () => {
    expect(countLabel(0, 'Zuweisung', 'Zuweisungen')).toBe('0 Zuweisungen')
    expect(countLabel(1, 'Zuweisung', 'Zuweisungen')).toBe('1 Zuweisung')
    expect(countLabel(1250, 'Zuweisung', 'Zuweisungen')).toBe('1.250 Zuweisungen')
  })

  it('weist nur auf gekürzte Listen hin („x von y“)', () => {
    expect(historyCapHint(200, 250, 'Zuweisungen')).toBe('200 von 250 Zuweisungen angezeigt (neueste zuerst).')
    expect(historyCapHint(200, 1500, 'Statusänderungen'))
      .toBe('200 von 1.500 Statusänderungen angezeigt (neueste zuerst).')
    expect(historyCapHint(3, 3, 'Zuweisungen')).toBeNull()
    expect(historyCapHint(0, 0, 'Zuweisungen')).toBeNull()
  })
})
