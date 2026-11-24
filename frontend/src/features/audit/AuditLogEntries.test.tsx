// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { AuditLogEntry } from './auditLogApi'
import { AuditLogEntries } from './AuditLogEntries'

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-11-23T10:15:30Z',
    action: 'DEVICE_ASSIGNED',
    entity_type: 'device',
    entity_id: '7d0f0d43-8a3a-4c1e-9d55-0f3c1b6a2e10',
    entity_title: 'IT-0003',
    user_id: '22222222-2222-4222-8222-222222222222',
    user_name: 'Max Admin',
    user_email: 'max@example.invalid',
    details: { employee_name: 'Erika Muster' },
    ...overrides,
  }
}

describe('Audit-Einträge – Tabelle', () => {
  afterEach(cleanup)

  it('nutzt eine semantische Tabelle mit Spaltenköpfen und Detailliste', () => {
    render(<AuditLogEntries entries={[makeEntry()]} />)
    const table = screen.getByRole('table', { name: 'Audit-Einträge' })
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map(header => header.textContent)).toEqual(['Zeitpunkt', 'Benutzer', 'Aktion', 'Objekt', 'Details'])
    expect(headers.every(header => header.getAttribute('scope') === 'col')).toBe(true)
    expect(within(table).getByRole('list').tagName).toBe('UL')
    expect(within(table).getByRole('listitem').textContent).toBe('Mitarbeiter: Erika Muster')
    expect(within(table).getByText('Gerät zugewiesen')).toBeTruthy()
  })

  it('zeigt Name und E-Mail, nur E-Mail oder „System“ als ausführenden Benutzer', () => {
    render(<AuditLogEntries entries={[
      makeEntry(),
      makeEntry({ id: 'b', user_name: null, user_email: 'nur-mail@example.invalid' }),
      makeEntry({ id: 'c', user_id: null, user_name: null, user_email: null }),
    ]} />)
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('Max Admin')).toBeTruthy()
    expect(within(rows[0]!).getByText('max@example.invalid')).toBeTruthy()
    expect(within(rows[1]!).getAllByText('nur-mail@example.invalid')).toHaveLength(1)
    expect(within(rows[2]!).getByText('System').className).toBe('audit-system')
  })

  it('zeigt Rollen, Altdaten und fehlende Details verständlich an', () => {
    render(<AuditLogEntries entries={[
      makeEntry({ id: 'r', action: 'ROLE_PERMISSIONS_CHANGED', entity_type: 'role', entity_id: null,
        entity_title: 'device_manager', details: { role: 'device_manager', permissions: ['dashboard:view'] } }),
      makeEntry({ id: 'l', action: 'LEGACY_IMPORT', entity_type: 'assignment', entity_title: null, details: {} }),
      makeEntry({ id: 'x', created_at: 'kein Datum' }),
    ]} />)
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('Rollenberechtigungen geändert')).toBeTruthy()
    expect(within(rows[0]!).getByText('Rolle')).toBeTruthy()
    expect(within(rows[0]!).getByText('Gerätemanager')).toBeTruthy()
    expect(within(rows[0]!).getByText('Berechtigungen: Dashboard ansehen')).toBeTruthy()
    expect(within(rows[1]!).getByText('LEGACY_IMPORT')).toBeTruthy()
    expect(within(rows[1]!).getByText('assignment')).toBeTruthy()
    expect(within(rows[1]!).getByText('Keine Details')).toBeTruthy()
    expect(within(rows[1]!).queryByRole('list')).toBeNull()
    const time = rows[2]!.querySelector('time')!
    expect(time.textContent).toBe('–')
    expect(time.hasAttribute('datetime')).toBe(false)
  })
})
