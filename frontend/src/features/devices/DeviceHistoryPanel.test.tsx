// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import type { Permission, Role } from '../../config/permissions'
import { useAuthSession } from '../../hooks/useAuthSession'
import { auditLogApi, type AuditLogEntry } from '../audit/auditLogApi'
import { DeviceHistoryPanel } from './DeviceHistoryPanel'
import { DeviceHistoryError, deviceHistoryApi, type DeviceHistory } from './deviceHistoryApi'

vi.mock('../../hooks/useAuthSession', () => ({ useAuthSession: vi.fn() }))
vi.mock('./deviceHistoryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./deviceHistoryApi')>()
  return { ...actual, deviceHistoryApi: { load: vi.fn() } }
})
vi.mock('../audit/auditLogApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../audit/auditLogApi')>()
  return { ...actual, auditLogApi: { list: vi.fn() } }
})

const DEVICE_A = '7d0f0d43-8a3a-4c1e-9d55-0f3c1b6a2e10'
const DEVICE_B = '8e1f1e54-9b4b-4d2f-8e66-1f4d2c7b3f21'

function auth(role: Role | null, permissions: readonly Permission[] | null = null) {
  vi.mocked(useAuthSession).mockReturnValue({
    session: {} as Session,
    user: null,
    userId: '00000000-0000-4000-8000-000000000001',
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

function history(overrides: Partial<DeviceHistory> = {}): DeviceHistory {
  return {
    device: {
      id: DEVICE_A, asset_tag: 'IT-0003', name: 'Notebook Vertrieb', device_type: 'Laptop',
      manufacture: 'Lenovo', model: 'ThinkPad T14', status: 'assigned',
    },
    assignments: [
      {
        assignment_id: 'a2', employee_id: 'e2', employee_name: 'Max Beispiel', employee_email: 'max@example.invalid',
        assigned_at: '2026-11-20T09:00:00Z', assigned_by_name: 'Gabi Gerätemanager',
        returned_at: null, returned_by_name: null, active: true,
      },
      {
        assignment_id: 'a1', employee_id: 'e1', employee_name: 'Erika Muster', employee_email: 'erika@example.invalid',
        assigned_at: '2026-11-01T09:00:00Z', assigned_by_name: 'Ada Admin',
        returned_at: '2026-11-04T09:00:00Z', returned_by_name: 'Gabi Gerätemanager', active: false,
      },
    ],
    assignments_total: 2,
    status_changes: [
      { id: 's3', old_status: 'available', new_status: 'assigned', changed_at: '2026-11-20T09:00:00Z', changed_by_name: 'Gabi Gerätemanager' },
      { id: 's2', old_status: 'assigned', new_status: 'available', changed_at: '2026-11-04T09:00:00Z', changed_by_name: null },
    ],
    status_changes_total: 2,
    ...overrides,
  }
}

function auditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-11-20T09:00:00Z',
    action: 'DEVICE_ASSIGNED',
    entity_type: 'device',
    entity_id: DEVICE_A,
    entity_title: 'IT-0003',
    user_id: '22222222-2222-4222-8222-222222222222',
    user_name: 'Gabi Gerätemanager',
    user_email: 'gabi@example.invalid',
    details: { employee_name: 'Max Beispiel' },
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(deviceHistoryApi.load).mockReset()
  vi.mocked(auditLogApi.list).mockReset()
})

afterEach(() => {
  cleanup()
})

describe('Gerätehistorie – Anzeige (PBI-12, FA-14)', () => {
  it('zeigt vergangene und aktive Zuweisungen mit Mitarbeiter, Beginn und Ende', async () => {
    auth('device_manager')
    vi.mocked(deviceHistoryApi.load).mockResolvedValue(history())
    render(<DeviceHistoryPanel deviceId={DEVICE_A} />)

    const table = await screen.findByRole('table', { name: /Zuweisungen dieses Gerätes/ })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)

    // Aktive Zuweisung: Mitarbeiter, Beginn, „Aktiv“ statt Ende
    expect(within(rows[0]!).getByRole('rowheader').textContent).toContain('Max Beispiel')
    expect(within(rows[0]!).getByText('Aktiv')).toBeTruthy()
    expect(within(rows[0]!).getAllByRole('cell')[0]!.querySelector('time')?.getAttribute('dateTime'))
      .toBe('2026-11-20T09:00:00Z')

    // Abgeschlossene Zuweisung bleibt nach der Rückgabe sichtbar: Beginn, Ende, Dauer, Rücknahme
    const past = within(rows[1]!)
    expect(past.getByRole('rowheader').textContent).toContain('Erika Muster')
    expect(past.getByRole('rowheader').textContent).toContain('erika@example.invalid')
    const times = rows[1]!.querySelectorAll('time')
    expect(Array.from(times).map(time => time.getAttribute('dateTime')))
      .toEqual(['2026-11-01T09:00:00Z', '2026-11-04T09:00:00Z'])
    expect(past.getByText('3 Tage')).toBeTruthy()
    expect(past.getByText('Ada Admin')).toBeTruthy()
    expect(past.getByText('Gabi Gerätemanager')).toBeTruthy()

    expect(screen.getByText(/Insgesamt 2 Zuweisungen, davon 1 aktiv\./)).toBeTruthy()
    expect(deviceHistoryApi.load).toHaveBeenCalledWith(DEVICE_A)
  })

  it('stellt Statusänderungen mit altem und neuem Status, Zeitpunkt und Benutzer dar', async () => {
    auth('device_manager')
    vi.mocked(deviceHistoryApi.load).mockResolvedValue(history())
    render(<DeviceHistoryPanel deviceId={DEVICE_A} />)

    const timeline = await screen.findByRole('list', { name: 'Statusverlauf' })
    const items = within(timeline).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Status von Verfügbar→ auf Zugewiesen')
    expect(items[0].textContent).toContain('Geändert von: Gabi Gerätemanager')
    expect(items[0]!.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-20T09:00:00Z')
    // Ohne gespeicherten Benutzer erscheint „System“
    expect(items[1].textContent).toContain('Geändert von: System')
  })

  it('zeigt verständliche Leerzustände', async () => {
    auth('admin', ['devices:view_all', 'assignments:view_all'])
    vi.mocked(deviceHistoryApi.load).mockResolvedValue(history({
      assignments: [], assignments_total: 0, status_changes: [], status_changes_total: 0,
    }))
    render(<DeviceHistoryPanel deviceId={DEVICE_A} />)

    expect(await screen.findByText('Dieses Gerät wurde noch nie zugewiesen.')).toBeTruthy()
    expect(screen.getByText('Noch keine Statusänderungen protokolliert.')).toBeTruthy()
  })

  it('weist auf gekürzte Listen hin, wenn der Server mehr Einträge kennt', async () => {
    auth('device_manager')
    vi.mocked(deviceHistoryApi.load).mockResolvedValue(history({ assignments_total: 250, status_changes_total: 2 }))
    render(<DeviceHistoryPanel deviceId={DEVICE_A} />)

    expect(await screen.findByText('2 von 250 Zuweisungen angezeigt (neueste zuerst).')).toBeTruthy()
  })
})

describe('Gerätehistorie – Berechtigungen', () => {
  it('bleibt für Mitarbeiter unsichtbar und ruft keine Daten ab', () => {
    auth('employee')
    const { container } = render(<DeviceHistoryPanel deviceId={DEVICE_A} />)
    expect(container.innerHTML).toBe('')
    expect(deviceHistoryApi.load).not.toHaveBeenCalled()
  })

  it('bleibt ohne assignments:view_all unsichtbar', () => {
    auth('device_manager', ['devices:view_all', 'devices:manage'])
    const { container } = render(<DeviceHistoryPanel deviceId={DEVICE_A} />)
    expect(container.innerHTML).toBe('')
    expect(deviceHistoryApi.load).not.toHaveBeenCalled()
  })

  it('zeigt Gerätemanagern kein Änderungsprotokoll', async () => {
    auth('device_manager')
    vi.mocked(deviceHistoryApi.load).mockResolvedValue(history())
    render(<DeviceHistoryPanel deviceId={DEVICE_A} />)

    await screen.findByRole('table', { name: /Zuweisungen dieses Gerätes/ })
    expect(screen.queryByRole('heading', { name: 'Änderungsprotokoll' })).toBeNull()
    expect(auditLogApi.list).not.toHaveBeenCalled()
  })

  it('zeigt Administratoren zusätzlich das Änderungsprotokoll des Gerätes', async () => {
    auth('admin')
    vi.mocked(deviceHistoryApi.load).mockResolvedValue(history())
    vi.mocked(auditLogApi.list).mockResolvedValue({ total: 1, page_size: 25, items: [auditEntry()] })
    render(<DeviceHistoryPanel deviceId={DEVICE_A} />)

    expect(await screen.findByRole('heading', { name: 'Änderungsprotokoll' })).toBeTruthy()
    expect(await screen.findByText('Gerät zugewiesen')).toBeTruthy()
    expect(auditLogApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ action: '', entityType: '', search: '' }),
      0,
      { type: 'device', id: DEVICE_A },
    )
  })
})

describe('Gerätehistorie – Laden und Fehler', () => {
  it('zeigt einen Fehler mit „Erneut versuchen“ und lädt danach neu', async () => {
    auth('device_manager')
    vi.mocked(deviceHistoryApi.load)
      .mockRejectedValueOnce(new DeviceHistoryError('Keine Berechtigung für die Gerätehistorie.', 'forbidden'))
      .mockResolvedValueOnce(history())
    render(<DeviceHistoryPanel deviceId={DEVICE_A} />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Keine Berechtigung für die Gerätehistorie.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByRole('table', { name: /Zuweisungen dieses Gerätes/ })).toBeTruthy()
    expect(deviceHistoryApi.load).toHaveBeenCalledTimes(2)
  })

  it('verwirft veraltete Antworten nach einem schnellen Gerätewechsel', async () => {
    auth('device_manager')
    const slow = deferred<DeviceHistory>()
    vi.mocked(deviceHistoryApi.load).mockImplementation(id => id === DEVICE_A
      ? slow.promise
      : Promise.resolve(history({
        device: { ...history().device, id: DEVICE_B, asset_tag: 'IT-0004' },
        assignments: [], assignments_total: 0,
      })))
    const { rerender } = render(<DeviceHistoryPanel deviceId={DEVICE_A} />)
    rerender(<DeviceHistoryPanel deviceId={DEVICE_B} />)

    expect(await screen.findByText('Dieses Gerät wurde noch nie zugewiesen.')).toBeTruthy()
    slow.resolve(history())
    await waitFor(() => expect(deviceHistoryApi.load).toHaveBeenCalledTimes(2))
    // Die verspätete Antwort für Gerät A darf die Anzeige von Gerät B nicht überschreiben.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText('Max Beispiel')).toBeNull()
    expect(screen.getByText('Dieses Gerät wurde noch nie zugewiesen.')).toBeTruthy()
  })

  it('lädt neu, wenn die Seite den refreshKey erhöht (z. B. nach einer Rückgabe)', async () => {
    auth('device_manager')
    vi.mocked(deviceHistoryApi.load)
      .mockResolvedValueOnce(history())
      .mockResolvedValueOnce(history({
        assignments: history().assignments.map(item => item.active
          ? { ...item, active: false, returned_at: '2026-11-23T09:00:00Z', returned_by_name: 'Ada Admin' }
          : item),
      }))
    const { rerender } = render(<DeviceHistoryPanel deviceId={DEVICE_A} refreshKey={0} />)
    expect(await screen.findByText(/davon 1 aktiv/)).toBeTruthy()

    rerender(<DeviceHistoryPanel deviceId={DEVICE_A} refreshKey={1} />)
    expect(await screen.findByText(/davon keine aktiv/)).toBeTruthy()
    // Beide Zuweisungen bleiben nach der Rückgabe in der Historie erhalten.
    expect(within(screen.getByRole('table', { name: /Zuweisungen dieses Gerätes/ })).getAllByRole('row')).toHaveLength(3)
  })
})
