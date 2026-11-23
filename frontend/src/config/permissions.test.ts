
import { describe, expect, it } from 'vitest'
import { hasPermission, canAssignRole } from './permissions'

describe('Rollen und Berechtigungen', () => {
  it('Nur SuperAdmin darf Admin ernennen und Rechte ändern', () => {
    expect(hasPermission('super_admin', 'permissions:manage')).toBe(true)
    expect(hasPermission('admin', 'permissions:manage')).toBe(false)
    expect(canAssignRole('admin', 'employee', 'admin', false)).toBe(false)
    expect(canAssignRole('super_admin', 'employee', 'admin', false)).toBe(true)
    expect(canAssignRole('super_admin', 'super_admin', 'admin', false)).toBe(false)
    expect(canAssignRole('super_admin', 'employee', 'super_admin', false)).toBe(false)
    expect(canAssignRole('super_admin', 'employee', 'admin', true)).toBe(false)
  })
  it('Bei dynamisch geladenen Rechten gilt die Serverliste', () => {
    expect(hasPermission('admin', 'devices:manage', [])).toBe(false)
    expect(hasPermission('employee', 'devices:manage', ['devices:manage'])).toBe(true)
    expect(hasPermission(null, 'devices:manage', ['devices:manage'])).toBe(false)
  })
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

