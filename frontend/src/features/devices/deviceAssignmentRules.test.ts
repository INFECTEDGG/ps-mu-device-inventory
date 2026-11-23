import { describe, expect, it } from 'vitest'
import { isDeviceAssignable, mayAssignDevices } from './deviceAssignmentRules'

describe('Gerätezuweisung – Rechte und Voraussetzungen', () => {
  it('erlaubt nur verfügbare Geräte', () => {
    expect(isDeviceAssignable('available')).toBe(true)
    for (const status of ['assigned', 'maintenance', 'defective', 'retired', null] as const) {
      expect(isDeviceAssignable(status)).toBe(false)
    }
  })

  it('erlaubt die Zuweisungsverwaltung nur autorisierten Rollen', () => {
    expect(mayAssignDevices('super_admin')).toBe(true)
    expect(mayAssignDevices('admin')).toBe(true)
    expect(mayAssignDevices('device_manager')).toBe(true)
    expect(mayAssignDevices('employee')).toBe(false)
    expect(mayAssignDevices(null)).toBe(false)
  })

  it('beachtet serverseitig geladene dynamische Berechtigungen', () => {
    expect(mayAssignDevices('device_manager', [])).toBe(false)
    expect(mayAssignDevices('device_manager', ['assignments:manage'])).toBe(true)
    expect(mayAssignDevices('employee', ['assignments:manage'])).toBe(false)
  })
})
