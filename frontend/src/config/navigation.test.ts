import { describe, expect, it } from 'vitest'
import { canOpenNavigationEntry, navigationEntries } from './navigation'

const auditEntry = navigationEntries.find(entry => entry.path === '/audit-log')!
const devicesEntry = navigationEntries.find(entry => entry.path === '/geraete')!

describe('Navigation – Zugriffsregel für Menü und Seiten', () => {
  it('zeigt das Audit-Log nur Administratoren und SuperAdmins mit audit:view', () => {
    expect(canOpenNavigationEntry(auditEntry, 'admin')).toBe(true)
    expect(canOpenNavigationEntry(auditEntry, 'super_admin')).toBe(true)
    expect(canOpenNavigationEntry(auditEntry, 'device_manager')).toBe(false)
    expect(canOpenNavigationEntry(auditEntry, 'employee')).toBe(false)
    expect(canOpenNavigationEntry(auditEntry, null)).toBe(false)
  })

  it('blendet das Audit-Log für andere Rollen aus, auch wenn ihnen audit:view zugewiesen wurde', () => {
    expect(canOpenNavigationEntry(auditEntry, 'device_manager', ['audit:view'])).toBe(false)
    expect(canOpenNavigationEntry(auditEntry, 'employee', ['audit:view'])).toBe(false)
  })

  it('entzieht Administratoren das Audit-Log, wenn audit:view entfernt wurde', () => {
    expect(canOpenNavigationEntry(auditEntry, 'admin', ['dashboard:view', 'users:manage'])).toBe(false)
  })

  it('lässt Einträge ohne Rollenbeschränkung unverändert über die Berechtigung steuern', () => {
    expect(devicesEntry.allowedRoles).toBeUndefined()
    expect(canOpenNavigationEntry(devicesEntry, 'employee')).toBe(true)
    expect(canOpenNavigationEntry(devicesEntry, 'employee', ['dashboard:view'])).toBe(false)
  })
})
