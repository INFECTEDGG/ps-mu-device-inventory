
import { describe, expect, it } from 'vitest'
import { hasPermission } from './permissions'

describe('Rollen und Berechtigungen', () => {
  it('Admin darf Benutzer verwalten', () => {
    expect(hasPermission('admin', 'users:manage')).toBe(true)
  })

  it('Gerätemanager darf Geräte verwalten', () => {
    expect(hasPermission('device_manager', 'devices:manage')).toBe(true)
  })

  it('Gerätemanager darf keine Benutzer verwalten', () => {
    expect(hasPermission('device_manager', 'users:manage')).toBe(false)
  })

  it('Mitarbeiter darf eigene Geräte sehen', () => {
    expect(hasPermission('employee', 'devices:view_own')).toBe(true)
  })

  it('Mitarbeiter darf keine fremden Geräte verwalten', () => {
    expect(hasPermission('employee', 'devices:manage')).toBe(false)
  })

  it('Mitarbeiter darf keine Rollen ändern', () => {
    expect(hasPermission('employee', 'roles:manage')).toBe(false)
  })

  it('Benutzer ohne Rolle erhält keine Berechtigung', () => {
    expect(hasPermission(null, 'dashboard:view')).toBe(false)
  })
})

