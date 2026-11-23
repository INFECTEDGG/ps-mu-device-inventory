// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import type { Permission, Role } from '../../config/permissions'
import { useAuthSession } from '../../hooks/useAuthSession'
import { mayViewAuditLog } from './auditAccess'
import {
  AuditLogError,
  EMPTY_AUDIT_FILTERS,
  auditLogApi,
  type AuditLogEntry,
  type AuditLogPage as AuditLogResult,
} from './auditLogApi'
import { AuditLogPage } from './AuditLogPage'

vi.mock('../../hooks/useAuthSession', () => ({ useAuthSession: vi.fn() }))
vi.mock('./auditLogApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auditLogApi')>()
  return { ...actual, auditLogApi: { list: vi.fn() } }
})

function auth(role: Role | null = 'admin', permissions: readonly Permission[] | null = null, signedIn = true) {
  vi.mocked(useAuthSession).mockReturnValue({
    session: signedIn ? ({} as Session) : null,
    user: null,
    userId: signedIn ? '00000000-0000-4000-8000-000000000001' : null,
    role,
    permissions,
    isLoading: false,
    isRoleLoading: false,
    isSigningOut: false,
    profileError: null,
    sessionNotice: null,
    clearSessionNotice: vi.fn(),
    reloadProfile: vi.fn(),
  })
}

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-11-23T10:15:30Z',
    action: 'DEVICE_STATUS_CHANGED',
    entity_type: 'device',
    entity_id: '7d0f0d43-8a3a-4c1e-9d55-0f3c1b6a2e10',
    entity_title: 'IT-0003',
    user_id: '22222222-2222-4222-8222-222222222222',
    user_name: 'Erika Muster',
    user_email: 'erika@example.invalid',
    details: { old_status: 'available', new_status: 'assigned' },
    ...overrides,
  }
}

function page(items: AuditLogEntry[], total = items.length): AuditLogResult {
  return { total, page_size: 25, items }
}

function manyEntries(count: number, offset = 0): AuditLogEntry[] {
  return Array.from({ length: count }, (_, index) => makeEntry({
    id: `00000000-0000-4000-8000-${String(offset + index).padStart(12, '0')}`,
    entity_title: `IT-${String(offset + index).padStart(4, '0')}`,
  }))
}

const allExceptAudit: Permission[] = ['dashboard:view', 'devices:view_all', 'users:manage', 'settings:view']

describe('Audit-Log – Zugriffsregel', () => {
  it('erlaubt nur Administratoren und SuperAdmins mit audit:view', () => {
    expect(mayViewAuditLog('admin')).toBe(true)
    expect(mayViewAuditLog('super_admin')).toBe(true)
    expect(mayViewAuditLog('device_manager')).toBe(false)
    expect(mayViewAuditLog('employee')).toBe(false)
    expect(mayViewAuditLog(null)).toBe(false)
    expect(mayViewAuditLog('admin', allExceptAudit)).toBe(false)
    expect(mayViewAuditLog('device_manager', ['audit:view'])).toBe(false)
    expect(mayViewAuditLog('admin', ['audit:view'])).toBe(true)
  })
})

describe('Audit-Log-Seite', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    auth()
    vi.mocked(auditLogApi.list).mockResolvedValue(page([makeEntry()]))
  })
  afterEach(cleanup)

  it('zeigt Zeitpunkt, Benutzer, Aktion, Objekt und Details eines Eintrags', async () => {
    render(<AuditLogPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Audit-Log' })).toBeTruthy()
    const table = await screen.findByRole('table', { name: 'Audit-Einträge' })
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent))
      .toEqual(['Zeitpunkt', 'Benutzer', 'Aktion', 'Objekt', 'Details'])
    expect(within(table).getByText('Erika Muster')).toBeTruthy()
    expect(within(table).getByText('erika@example.invalid')).toBeTruthy()
    expect(within(table).getByText('Gerätestatus geändert')).toBeTruthy()
    expect(within(table).getByText('Gerät')).toBeTruthy()
    expect(within(table).getByText('IT-0003')).toBeTruthy()
    expect(within(table).getByRole('listitem').textContent).toBe('Status: Verfügbar → Zugewiesen')
    const time = table.querySelector('time')
    expect(time?.getAttribute('dateTime')).toBe('2026-11-23T10:15:30Z')
    const local = new Date('2026-11-23T10:15:30Z')
    const pad = (value: number) => String(value).padStart(2, '0')
    expect(time?.textContent).toBe(`${pad(local.getDate())}.${pad(local.getMonth() + 1)}.${local.getFullYear()}, ` +
      `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`)
    expect(screen.getByRole('status').textContent).toBe('1 Eintrag gefunden.')
    expect(auditLogApi.list).toHaveBeenCalledWith(EMPTY_AUDIT_FILTERS, 0)
  })

  it('macht die Tabelle per Tastatur scrollbar', async () => {
    render(<AuditLogPage />)
    const region = await screen.findByRole('region', { name: 'Audit-Einträge' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.querySelector('table')).toBeTruthy()
  })

  it('zeigt Einträge ohne ausführenden Benutzer als „System“', async () => {
    vi.mocked(auditLogApi.list).mockResolvedValue(page([
      makeEntry({ user_id: null, user_name: null, user_email: null, action: 'USER_CREATED', entity_type: 'user',
        entity_title: 'Kim Test', details: { first_name: 'Kim', last_name: 'Test', role: 'employee' } }),
    ]))
    render(<AuditLogPage />)
    const table = await screen.findByRole('table', { name: 'Audit-Einträge' })
    expect(within(table).getByText('System')).toBeTruthy()
    expect(within(table).getByText('Benutzer angelegt')).toBeTruthy()
    expect(within(table).getByText('Rolle: Mitarbeiter')).toBeTruthy()
  })

  it.each([
    ['Mitarbeiter', 'employee' as const, null],
    ['Gerätemanager', 'device_manager' as const, null],
    ['Gerätemanager mit zugewiesenem audit:view', 'device_manager' as const, ['audit:view'] as Permission[]],
    ['Administrator ohne audit:view', 'admin' as const, allExceptAudit],
  ])('verweigert %s den Zugriff ohne Datenabruf', (_label, role, permissions) => {
    auth(role, permissions)
    render(<AuditLogPage />)
    expect(screen.getByRole('heading', { name: 'Zugriff verweigert' })).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(auditLogApi.list).not.toHaveBeenCalled()
  })

  it('verweigert den Zugriff ohne Anmeldung', () => {
    auth(null, null, false)
    render(<AuditLogPage />)
    expect(screen.getByText('Zugriff verweigert')).toBeTruthy()
    expect(auditLogApi.list).not.toHaveBeenCalled()
  })

  it('erlaubt SuperAdmins den Zugriff', async () => {
    auth('super_admin')
    render(<AuditLogPage />)
    expect(await screen.findByText('IT-0003')).toBeTruthy()
  })

  it('zeigt einen Ladezustand als Statusmeldung', () => {
    vi.mocked(auditLogApi.list).mockReturnValue(new Promise(() => undefined))
    render(<AuditLogPage />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Audit-Einträge werden geladen …')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('zeigt einen leeren Zustand', async () => {
    vi.mocked(auditLogApi.list).mockResolvedValue(page([]))
    render(<AuditLogPage />)
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toBe('Keine Audit-Einträge für die gewählten Filter gefunden.'))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Seitenauswahl' })).toBeNull()
  })

  it('zeigt Ladefehler als Warnung und lädt auf Wunsch erneut', async () => {
    vi.mocked(auditLogApi.list)
      .mockRejectedValueOnce(new AuditLogError('Keine Berechtigung für das Audit-Log.', 'forbidden'))
    render(<AuditLogPage />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Keine Berechtigung für das Audit-Log.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }))
    expect(await screen.findByText('IT-0003')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(auditLogApi.list).toHaveBeenCalledTimes(2)
  })

  it('zeigt unerwartete Fehler mit einer allgemeinen Meldung', async () => {
    vi.mocked(auditLogApi.list).mockRejectedValueOnce(new Error('intern'))
    render(<AuditLogPage />)
    expect((await screen.findByRole('alert')).textContent).toContain('Das Audit-Log konnte nicht geladen werden.')
  })

  it('bietet alle Aktionen gruppiert sowie alle Objekttypen zur Auswahl an', async () => {
    render(<AuditLogPage />)
    await screen.findByText('IT-0003')
    const action = screen.getByLabelText('Aktion')
    for (const group of ['Geräte', 'Zuweisungen', 'Benutzer', 'Rollen']) {
      expect(within(action).getByRole('group', { name: group })).toBeTruthy()
    }
    expect(within(action).getAllByRole('option')).toHaveLength(16)
    expect(within(within(action).getByRole('group', { name: 'Zuweisungen' })).getAllByRole('option')
      .map(option => option.textContent))
      .toEqual(['Gerät zugewiesen', 'Gerät zurückgenommen', 'Zuweisung korrigiert', 'Zuweisung gelöscht'])
    expect(within(screen.getByLabelText('Objekttyp')).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Alle Objekttypen', 'Gerät', 'Benutzer', 'Rolle'])
    expect(screen.getByRole('group', { name: 'Zeitraum' })).toBeTruthy()
    expect(screen.getByLabelText('Suche').getAttribute('maxlength')).toBe('100')
  })

  it('wendet Filter erst beim Absenden an und trimmt die Suche', async () => {
    render(<AuditLogPage />)
    await screen.findByText('IT-0003')
    fireEvent.change(screen.getByLabelText('Aktion'), { target: { value: 'DEVICE_STATUS_CHANGED' } })
    fireEvent.change(screen.getByLabelText('Objekttyp'), { target: { value: 'device' } })
    fireEvent.change(screen.getByLabelText('Suche'), { target: { value: '  IT-0003  ' } })
    fireEvent.change(screen.getByLabelText('Von'), { target: { value: '2026-11-01' } })
    fireEvent.change(screen.getByLabelText('Bis'), { target: { value: '2026-11-23' } })
    expect(auditLogApi.list).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Filter anwenden' }))
    await waitFor(() => expect(auditLogApi.list).toHaveBeenLastCalledWith({
      action: 'DEVICE_STATUS_CHANGED', entityType: 'device', search: 'IT-0003', from: '2026-11-01', to: '2026-11-23',
    }, 0))
    expect((screen.getByLabelText('Suche') as HTMLInputElement).value).toBe('IT-0003')
  })

  it('meldet einen ungültigen Zeitraum am Feld und lädt nicht', async () => {
    render(<AuditLogPage />)
    await screen.findByText('IT-0003')
    fireEvent.change(screen.getByLabelText('Von'), { target: { value: '2026-11-24' } })
    fireEvent.change(screen.getByLabelText('Bis'), { target: { value: '2026-11-23' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filter anwenden' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Das Startdatum darf nicht nach dem Enddatum liegen.')
    const from = screen.getByLabelText('Von')
    expect(from.getAttribute('aria-invalid')).toBe('true')
    expect(from.getAttribute('aria-describedby')).toBe('audit-filter-error')
    expect(document.activeElement).toBe(from)
    expect(auditLogApi.list).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Von'), { target: { value: '2026-11-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filter anwenden' }))
    await waitFor(() => expect(auditLogApi.list).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('setzt alle Filter zurück und lädt ungefiltert neu', async () => {
    render(<AuditLogPage />)
    await screen.findByText('IT-0003')
    fireEvent.change(screen.getByLabelText('Aktion'), { target: { value: 'USER_CREATED' } })
    fireEvent.change(screen.getByLabelText('Suche'), { target: { value: 'Kim' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filter anwenden' }))
    await waitFor(() => expect(auditLogApi.list).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }))
    await waitFor(() => expect(auditLogApi.list).toHaveBeenCalledTimes(3))
    expect(auditLogApi.list).toHaveBeenLastCalledWith(EMPTY_AUDIT_FILTERS, 0)
    expect((screen.getByLabelText('Aktion') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Suche') as HTMLInputElement).value).toBe('')
  })

  it('blättert seitenweise und setzt den Fokus auf die Ergebnisse', async () => {
    vi.mocked(auditLogApi.list).mockImplementation(async (_filters, pageIndex) =>
      page(manyEntries(pageIndex === 2 ? 10 : 25, pageIndex * 25), 60))
    render(<AuditLogPage />)
    await screen.findByText('IT-0000')
    const pagination = screen.getByRole('navigation', { name: 'Seitenauswahl' })
    expect(pagination.textContent).toContain('Seite 1 von 3')
    expect((within(pagination).getByRole('button', { name: 'Zurück' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('60 Einträge gefunden.')
    fireEvent.click(within(pagination).getByRole('button', { name: 'Weiter' }))
    expect(await screen.findByText('IT-0025')).toBeTruthy()
    expect(auditLogApi.list).toHaveBeenLastCalledWith(EMPTY_AUDIT_FILTERS, 1)
    expect(screen.getByRole('navigation', { name: 'Seitenauswahl' }).textContent).toContain('Seite 2 von 3')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Einträge' })))
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(await screen.findByText('IT-0050')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Weiter' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Filter anwenden' }))
    await waitFor(() => expect(auditLogApi.list).toHaveBeenLastCalledWith(EMPTY_AUDIT_FILTERS, 0))
  })

  it('springt auf die letzte vorhandene Seite, wenn Einträge weggefallen sind', async () => {
    vi.mocked(auditLogApi.list)
      .mockResolvedValueOnce(page(manyEntries(25), 60))
      .mockResolvedValueOnce(page([], 20))
      .mockResolvedValueOnce(page(manyEntries(20, 100), 20))
    render(<AuditLogPage />)
    await screen.findByText('IT-0000')
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(await screen.findByText('IT-0100')).toBeTruthy()
    expect(vi.mocked(auditLogApi.list).mock.calls.map(([, pageIndex]) => pageIndex)).toEqual([0, 1, 0])
    expect(screen.queryByRole('navigation', { name: 'Seitenauswahl' })).toBeNull()
  })
})
