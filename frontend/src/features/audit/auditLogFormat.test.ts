import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deviceStatusLabel, deviceStatusLabels } from './deviceStatusLabels'
import { AUDIT_ACTIONS, type AuditLogEntry } from './auditLogApi'
import {
  AUDIT_ACTION_GROUPS,
  auditActionLabel,
  auditActorLabel,
  auditEntityLabel,
  auditEntityTitle,
  auditRoleLabel,
  describeAuditDetails,
  formatAuditTimestamp,
} from './auditLogFormat'

function entry(action: string, details: unknown): Pick<AuditLogEntry, 'action' | 'details'> {
  return { action, details: details as Record<string, unknown> }
}

/** Erwartete Anzeige unabhängig von Intl aus den lokalen Datumsbestandteilen berechnet. */
function localGerman(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

describe('Gerätestatus – gemeinsame Bezeichnungen', () => {
  it('übersetzt alle Status ins Deutsche', () => {
    expect(deviceStatusLabels).toEqual({
      available: 'Verfügbar', assigned: 'Zugewiesen', defective: 'Defekt',
      maintenance: 'Wartung', retired: 'Ausgemustert',
    })
    expect(deviceStatusLabel('maintenance')).toBe('Wartung')
  })

  it('zeigt fehlenden Status als „Nicht gesetzt“ und unbekannte Werte unverändert', () => {
    expect(deviceStatusLabel(null)).toBe('Nicht gesetzt')
    expect(deviceStatusLabel(undefined)).toBe('Nicht gesetzt')
    expect(deviceStatusLabel('  ')).toBe('Nicht gesetzt')
    expect(deviceStatusLabel('lost')).toBe('lost')
    expect(deviceStatusLabel('toString')).toBe('toString')
  })
})

describe('Audit-Log – Bezeichnungen', () => {
  it('liefert für jede Aktion die deutsche Bezeichnung', () => {
    expect(AUDIT_ACTIONS.map(action => auditActionLabel(action))).toEqual([
      'Gerät angelegt', 'Gerätedaten geändert', 'Gerätestatus geändert', 'Gerät gelöscht',
      'Gerät zugewiesen', 'Gerät zurückgenommen', 'Zuweisung korrigiert', 'Zuweisung gelöscht',
      'Benutzer angelegt', 'Benutzerdaten geändert', 'Benutzerrolle geändert', 'Benutzer deaktiviert',
      'Benutzer reaktiviert', 'Benutzer gelöscht', 'Rollenberechtigungen geändert',
    ])
  })

  it('zeigt unbekannte Aktionen unverändert statt leer', () => {
    expect(auditActionLabel('LEGACY_IMPORT')).toBe('LEGACY_IMPORT')
    expect(auditActionLabel('constructor')).toBe('constructor')
    expect(auditActionLabel('')).toBe('Unbekannte Aktion')
    expect(auditActionLabel(null)).toBe('Unbekannte Aktion')
  })

  it('gruppiert alle Aktionen genau einmal und in fester Reihenfolge', () => {
    expect(AUDIT_ACTION_GROUPS.map(group => group.label)).toEqual(['Geräte', 'Zuweisungen', 'Benutzer', 'Rollen'])
    expect(AUDIT_ACTION_GROUPS.flatMap(group => group.actions)).toEqual([...AUDIT_ACTIONS])
  })

  it('übersetzt Objekttypen und Rollen', () => {
    expect(['device', 'user', 'role'].map(auditEntityLabel)).toEqual(['Gerät', 'Benutzer', 'Rolle'])
    expect(auditEntityLabel('assignment')).toBe('assignment')
    expect(auditEntityLabel(null)).toBe('–')
    expect(['super_admin', 'admin', 'device_manager', 'employee'].map(auditRoleLabel))
      .toEqual(['SuperAdmin', 'Administrator', 'Gerätemanager', 'Mitarbeiter'])
    expect(auditRoleLabel(null)).toBe('Keine Rolle')
    expect(auditRoleLabel('auditor')).toBe('auditor')
  })

  it('zeigt den ausführenden Benutzer mit Name, sonst E-Mail, sonst „System“', () => {
    expect(auditActorLabel({ user_name: 'Erika Muster', user_email: 'erika@example.invalid' })).toBe('Erika Muster')
    expect(auditActorLabel({ user_name: '  ', user_email: ' erika@example.invalid ' })).toBe('erika@example.invalid')
    expect(auditActorLabel({ user_name: null, user_email: null })).toBe('System')
    expect(auditActorLabel({ user_name: '', user_email: '' })).toBe('System')
  })

  it('zeigt das betroffene Objekt; Rollen mit deutschem Namen', () => {
    expect(auditEntityTitle({ entity_type: 'device', entity_title: 'IT-0003' })).toBe('IT-0003')
    expect(auditEntityTitle({ entity_type: 'role', entity_title: 'device_manager' })).toBe('Gerätemanager')
    expect(auditEntityTitle({ entity_type: 'user', entity_title: null })).toBe('–')
  })
})

describe('Audit-Log – Zeitpunkt', () => {
  it('formatiert Datum und Uhrzeit mit Sekunden auf Deutsch', () => {
    expect(formatAuditTimestamp('2026-11-23T12:15:30Z')).toBe(localGerman('2026-11-23T12:15:30Z'))
    expect(formatAuditTimestamp('2026-11-23T12:15:30.123456+00:00')).toBe(localGerman('2026-11-23T12:15:30Z'))
    expect(formatAuditTimestamp('2026-01-05T08:09:07+02:00')).toBe(localGerman('2026-01-05T06:09:07Z'))
  })

  it('zeigt ungültige oder fehlende Zeitpunkte als „–“', () => {
    for (const value of ['', '  ', 'kein Datum', '2026-13-45T99:99:99Z', null, undefined]) {
      expect(formatAuditTimestamp(value)).toBe('–')
    }
  })

  describe('in deutscher Zeitzone', () => {
    const originalTimeZone = process.env.TZ
    beforeAll(() => { process.env.TZ = 'Europe/Berlin' })
    afterAll(() => {
      if (originalTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimeZone
    })

    it('rechnet UTC in Ortszeit um', () => {
      expect(formatAuditTimestamp('2026-11-23T12:15:30Z')).toBe('23.11.2026, 13:15:30')
      expect(formatAuditTimestamp('2026-07-01T22:30:00Z')).toBe('02.07.2026, 00:30:00')
    })
  })
})

describe('Audit-Log – Detailzeilen', () => {
  it('beschreibt Statusänderungen mit deutschen Statusnamen', () => {
    expect(describeAuditDetails(entry('DEVICE_STATUS_CHANGED', { old_status: 'available', new_status: 'assigned' })))
      .toEqual(['Status: Verfügbar → Zugewiesen'])
    expect(describeAuditDetails(entry('DEVICE_STATUS_CHANGED', { old_status: null, new_status: 'defective' })))
      .toEqual(['Status: Nicht gesetzt → Defekt'])
    expect(describeAuditDetails(entry('DEVICE_STATUS_CHANGED', { old_status: 'lost', new_status: 'retired' })))
      .toEqual(['Status: lost → Ausgemustert'])
  })

  it('beschreibt Zuweisung und Rücknahme mit Mitarbeiter, Beginn und Ende', () => {
    const assignedAt = '2026-11-20T08:00:00Z'
    const returnedAt = '2026-11-23T16:30:00Z'
    expect(describeAuditDetails(entry('DEVICE_ASSIGNED', {
      assignment_id: 'a', employee_id: 'e', employee_name: 'Erika Muster', assigned_at: assignedAt,
    }))).toEqual(['Mitarbeiter: Erika Muster'])
    expect(describeAuditDetails(entry('DEVICE_RETURNED', {
      assignment_id: 'a', employee_id: 'e', employee_name: 'Erika Muster', assigned_at: assignedAt, returned_at: returnedAt,
    }))).toEqual([
      'Mitarbeiter: Erika Muster',
      `Zugewiesen am: ${formatAuditTimestamp(assignedAt)}`,
      `Zurückgegeben am: ${formatAuditTimestamp(returnedAt)}`,
    ])
    expect(describeAuditDetails(entry('DEVICE_ASSIGNED', { employee_id: 'e', employee_name: null })))
      .toEqual(['Mitarbeiter: Unbekannt'])
  })

  it('beschreibt Rollenwechsel von Benutzern', () => {
    expect(describeAuditDetails(entry('USER_ROLE_CHANGED', { old_role: 'employee', new_role: 'device_manager' })))
      .toEqual(['Rolle: Mitarbeiter → Gerätemanager'])
    expect(describeAuditDetails(entry('USER_ROLE_CHANGED', { old_role: null, new_role: 'employee' })))
      .toEqual(['Rolle: Keine Rolle → Mitarbeiter'])
  })

  it('beschreibt geänderte Gerätedaten feldweise in fester Reihenfolge', () => {
    expect(describeAuditDetails(entry('DEVICE_UPDATED', {
      changes: {
        description: { old: '', new: 'Neu' },
        purchased_at: { old: null, new: '2026-01-15' },
        ram_gb: { old: 16, new: 32 },
        model: { old: 'T14', new: 'T16' },
        disk_space_gb: { old: 512, new: 1024 },
        custom_field: { old: 'a', new: 'b' },
      },
    }))).toEqual([
      'Modell: T14 → T16',
      'RAM (GB): 16 → 32',
      'Speicherplatz (GB): 512 → 1.024',
      'Kaufdatum: – → 15.01.2026',
      'Beschreibung: – → Neu',
      'custom_field: a → b',
    ])
  })

  it('formatiert Wahrheitswerte, Objekte und Listen lesbar', () => {
    expect(describeAuditDetails(entry('ASSIGNMENT_UPDATED', {
      assignment_id: 'a',
      changes: {
        is_spare: { old: true, new: false },
        meta: { old: { a: 1 }, new: null },
        tags: { old: [], new: ['x', 2] },
      },
    }))).toEqual(['is_spare: Ja → Nein', 'meta: {"a":1} → –', 'tags: – → x, 2'])
  })

  it('beschreibt geänderte Benutzerdaten', () => {
    expect(describeAuditDetails(entry('USER_UPDATED', { changes: { last_name: { old: 'Test', new: 'Muster' },
      first_name: { old: 'Kim', new: 'Kimberly' } } })))
      .toEqual(['Vorname: Kim → Kimberly', 'Nachname: Test → Muster'])
  })

  it('listet beim Anlegen eines Geräts die wichtigsten Felder', () => {
    expect(describeAuditDetails(entry('DEVICE_CREATED', {
      asset_tag: 'IT-0100', device_type: 'Laptop', manufacture: 'Lenovo', model: 'T14',
      serial_number: 'SN-1', status: 'available', location: 'Heilbronn',
    }))).toEqual([
      'Gerätetyp: Laptop', 'Hersteller: Lenovo', 'Modell: T14', 'Seriennummer: SN-1', 'Status: Verfügbar',
    ])
    expect(describeAuditDetails(entry('DEVICE_CREATED', { asset_tag: 'IT-0101', model: 'X1', status: null })))
      .toEqual(['Modell: X1', 'Status: Nicht gesetzt'])
  })

  it('beschreibt neue Benutzer mit Name, E-Mail und Rolle', () => {
    expect(describeAuditDetails(entry('USER_CREATED', {
      first_name: 'Erika', last_name: 'Muster', role: 'employee', email: 'erika@example.invalid',
    }))).toEqual(['Name: Erika Muster', 'E-Mail: erika@example.invalid', 'Rolle: Mitarbeiter'])
  })

  it('beschreibt Deaktivierung und Reaktivierung', () => {
    const disabledAt = '2026-11-23T09:00:00Z'
    expect(describeAuditDetails(entry('USER_DISABLED', { disabled_at: disabledAt })))
      .toEqual([`Deaktiviert am: ${formatAuditTimestamp(disabledAt)}`])
    expect(describeAuditDetails(entry('USER_ENABLED', {}))).toEqual([])
  })

  it('zeigt geänderte Rollenberechtigungen mit deutschen Bezeichnungen', () => {
    expect(describeAuditDetails(entry('ROLE_PERMISSIONS_CHANGED', {
      role: 'device_manager', permissions: ['dashboard:view', 'devices:view_all', 'custom:extra'],
    }))).toEqual(['Rolle: Gerätemanager', 'Berechtigungen: Dashboard ansehen, Alle Geräte ansehen, custom:extra'])
    expect(describeAuditDetails(entry('ROLE_PERMISSIONS_CHANGED', { role: 'employee', permissions: [] })))
      .toEqual(['Rolle: Mitarbeiter', 'Berechtigungen: keine'])
  })

  it('zeigt bei unerwarteter Form alle vorhandenen Angaben generisch an', () => {
    expect(describeAuditDetails(entry('DEVICE_UPDATED', { model: 'T14', note: 'manuell' })))
      .toEqual(['Modell: T14', 'note: manuell'])
    expect(describeAuditDetails(entry('LEGACY_IMPORT', { status: 'retired', changes: { model: { old: 'A', new: 'B' } } })))
      .toEqual(['Status: Ausgemustert', 'Modell: A → B'])
    expect(describeAuditDetails(entry('DEVICE_STATUS_CHANGED', { value: ['a', 'b'] }))).toEqual(['Wert: a, b'])
  })

  it('wirft bei keiner Detailform einen Fehler', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const odd: unknown[] = [
      null, undefined, 'Text', 42, [], ['a'], { changes: 'kaputt' }, { changes: ['x'] },
      { old_status: 7, new_status: { x: 1 } }, { permissions: 'dashboard:view' }, { role: 5 },
      { employee_name: 7 }, { first_name: ['x'] }, { disabled_at: 'kein Datum' },
      { nested: { deep: { deeper: [1, { x: null }] } } }, { loop: circular }, { big: BigInt(1) },
      { changes: { model: null, status: { old: 1, new: true } } },
    ]
    for (const action of [...AUDIT_ACTIONS, 'UNBEKANNT', '']) {
      for (const details of odd) {
        expect(() => describeAuditDetails(entry(action, details))).not.toThrow()
        expect(Array.isArray(describeAuditDetails(entry(action, details)))).toBe(true)
      }
    }
    expect(describeAuditDetails(null as unknown as AuditLogEntry)).toEqual([])
    expect(describeAuditDetails(entry('UNBEKANNT', { loop: circular }))).toEqual(['loop: [nicht darstellbar]'])
    expect(describeAuditDetails(entry('UNBEKANNT', { big: BigInt(1) }))).toEqual(['big: 1'])
    expect(describeAuditDetails(entry('UNBEKANNT', { list: [BigInt(2), circular] })))
      .toEqual(['list: 2, [nicht darstellbar]'])
    expect(describeAuditDetails(entry('DEVICE_UPDATED', { changes: 'kaputt' }))).toEqual(['Änderungen: kaputt'])
    expect(describeAuditDetails(entry('DEVICE_DISABLED', { disabled_at: 'kein Datum' })))
      .toEqual(['Deaktiviert am: kein Datum'])
  })

  it('kürzt sehr lange Texte und begrenzt die Anzahl der Zeilen', () => {
    const [longLine] = describeAuditDetails(entry('UNBEKANNT', { description: 'x'.repeat(500) }))
    expect(longLine).toBe(`Beschreibung: ${'x'.repeat(199)}…`)
    const manyChanges = Object.fromEntries(Array.from({ length: 20 }, (_, index) =>
      [`feld_${String(index).padStart(2, '0')}`, { old: index, new: index + 1 }]))
    const lines = describeAuditDetails(entry('DEVICE_UPDATED', { changes: manyChanges }))
    expect(lines).toHaveLength(12)
    expect(lines[0]).toBe('feld_00: 0 → 1')
    expect(lines[11]).toBe('… und 9 weitere Angaben')
  })

  it('kürzt Berechtigungslisten nicht', () => {
    const permissions = ['dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
      'assignments:view_own', 'assignments:view_all', 'assignments:manage', 'audit:view', 'settings:view']
    const [, line] = describeAuditDetails(entry('ROLE_PERMISSIONS_CHANGED', { role: 'admin', permissions }))
    expect(line).toBe('Berechtigungen: Dashboard ansehen, Eigene Geräte ansehen, Alle Geräte ansehen, ' +
      'Geräte verwalten, Eigene Zuweisungen ansehen, Alle Zuweisungen ansehen, Zuweisungen verwalten, ' +
      'Audit-Logs ansehen, Einstellungen ansehen')
    expect(line!.length).toBeGreaterThan(200)
  })
})
