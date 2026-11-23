import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  client: { current: true },
}))
vi.mock('../../lib/supabase', () => ({
  get supabase() {
    return calls.client.current ? { auth: { getSession: calls.getSession }, rpc: calls.rpc } : null
  },
}))

import {
  DEVICE_HISTORY_ROW_LIMIT,
  DeviceHistoryError,
  deviceHistoryApi,
  parseDeviceHistory,
} from './deviceHistoryApi'

const DEVICE_ID = '7d0f0d43-8a3a-4c1e-9d55-0f3c1b6a2e10'

const device = {
  id: DEVICE_ID,
  asset_tag: 'IT-0003',
  name: 'Notebook Empfang',
  device_type: 'Laptop',
  manufacture: 'Lenovo',
  model: 'T14',
  status: 'assigned',
}

const activeAssignment = {
  assignment_id: 'a2a2a2a2-0000-4000-8000-000000000002',
  employee_id: 'e1e1e1e1-0000-4000-8000-000000000001',
  employee_name: 'Erika Muster',
  employee_email: 'erika@example.invalid',
  assigned_at: '2026-11-20T08:00:00.123456+00:00',
  assigned_by_name: 'Max Manager',
  returned_at: null,
  returned_by_name: null,
  active: true,
}

const returnedAssignment = {
  assignment_id: 'a1a1a1a1-0000-4000-8000-000000000001',
  employee_id: null,
  employee_name: 'Unbekannt',
  employee_email: '',
  assigned_at: '2026-11-01T08:00:00+00:00',
  assigned_by_name: null,
  returned_at: '2026-11-04T09:30:00+00:00',
  returned_by_name: 'Ada Admin',
  active: false,
}

const statusChange = {
  id: 's1s1s1s1-0000-4000-8000-000000000001',
  old_status: 'available',
  new_status: 'assigned',
  changed_at: '2026-11-20T08:00:00.123456+00:00',
  changed_by_name: 'Max Manager',
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    device,
    assignments: [activeAssignment, returnedAssignment],
    assignments_total: 2,
    status_changes: [statusChange, { ...statusChange, id: 's0', old_status: null, new_status: 'available', changed_by_name: null }],
    status_changes_total: 2,
    ...overrides,
  }
}

describe('Gerätehistorie – Antwortvalidierung', () => {
  it('akzeptiert eine vollständige Historie und übernimmt nur die vereinbarten Schlüssel', () => {
    const history = parseDeviceHistory({
      ...payload(),
      extra: 'ignoriert',
      device: { ...device, serial_number: 'geheim' },
      assignments: [{ ...activeAssignment, intern: 1 }, returnedAssignment],
    })
    expect(history.device).toEqual(device)
    expect(history.assignments).toEqual([activeAssignment, returnedAssignment])
    expect(history.assignments_total).toBe(2)
    expect(history.status_changes[1]).toEqual({
      id: 's0', old_status: null, new_status: 'available',
      changed_at: statusChange.changed_at, changed_by_name: null,
    })
    expect(history.status_changes_total).toBe(2)
    expect(Object.keys(history)).toEqual(['device', 'assignments', 'assignments_total', 'status_changes', 'status_changes_total'])
  })

  it('akzeptiert leere Listen und fehlende Gerätefelder', () => {
    const history = parseDeviceHistory({
      device: { id: DEVICE_ID, asset_tag: null, name: null, device_type: null, manufacture: null, model: null, status: null },
      assignments: [], assignments_total: 0, status_changes: [], status_changes_total: 0,
    })
    expect(history.assignments).toEqual([])
    expect(history.device.status).toBeNull()
  })

  it('erlaubt Gesamtzahlen oberhalb der Obergrenze von 200 Zeilen', () => {
    expect(DEVICE_HISTORY_ROW_LIMIT).toBe(200)
    const history = parseDeviceHistory(payload({ assignments_total: 250, status_changes_total: 1000 }))
    expect(history.assignments_total).toBe(250)
    expect(history.status_changes_total).toBe(1000)
  })

  it.each([
    ['kein Objekt', null],
    ['ein Array', []],
    ['fehlendes Gerät', payload({ device: null })],
    ['Gerät ohne ID', payload({ device: { ...device, id: '' } })],
    ['Gerätefeld fehlt', payload({ device: { ...device, model: undefined } })],
    ['Gerätefeld mit falschem Typ', payload({ device: { ...device, status: 3 } })],
    ['Zuweisungen fehlen', payload({ assignments: undefined })],
    ['Statusliste kein Array', payload({ status_changes: {} })],
    ['negative Gesamtzahl', payload({ assignments_total: -1 })],
    ['Gesamtzahl kleiner als Liste', payload({ assignments_total: 1 })],
    ['Gesamtzahl keine Ganzzahl', payload({ status_changes_total: 1.5 })],
    ['Gesamtzahl als Text', payload({ status_changes_total: '2' })],
    ['Zuweisung ohne ID', payload({ assignments: [{ ...activeAssignment, assignment_id: '' }, returnedAssignment] })],
    ['Zuweisung ohne Beginn', payload({ assignments: [{ ...activeAssignment, assigned_at: null }, returnedAssignment] })],
    ['Mitarbeitername fehlt', payload({ assignments: [{ ...activeAssignment, employee_name: null }, returnedAssignment] })],
    ['E-Mail ist null', payload({ assignments: [{ ...activeAssignment, employee_email: null }, returnedAssignment] })],
    ['aktiv nicht boolesch', payload({ assignments: [{ ...activeAssignment, active: 'true' }, returnedAssignment] })],
    ['aktiv trotz Rückgabe', payload({ assignments: [activeAssignment, { ...returnedAssignment, active: true }] })],
    ['beendet ohne Rückgabezeitpunkt', payload({ assignments: [{ ...activeAssignment, active: false }, returnedAssignment] })],
    ['leerer Rückgabezeitpunkt', payload({ assignments: [activeAssignment, { ...returnedAssignment, returned_at: ' ' }] })],
    ['Statusänderung ohne Zeitpunkt', payload({ status_changes: [{ ...statusChange, changed_at: '' }], status_changes_total: 1 })],
    ['Statuswert mit falschem Typ', payload({ status_changes: [{ ...statusChange, new_status: 1 }], status_changes_total: 1 })],
    ['Statusänderung ohne Benutzerfeld', payload({ status_changes: [{ ...statusChange, changed_by_name: undefined }], status_changes_total: 1 })],
  ])('weist eine ungültige Antwort zurück: %s', (_label, value) => {
    expect(() => parseDeviceHistory(value)).toThrow(DeviceHistoryError)
    try {
      parseDeviceHistory(value)
    } catch (error) {
      expect((error as DeviceHistoryError).code).toBe('invalid_response')
      expect((error as DeviceHistoryError).message).toBe('Ungültige Antwort der Gerätehistorie empfangen.')
    }
  })
})

describe('Gerätehistorie – Laden über den RPC', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    calls.client.current = true
    calls.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null })
    calls.rpc.mockResolvedValue({ data: payload(), error: null })
  })

  it('ruft inventory_device_history mit der Geräte-ID auf', async () => {
    const history = await deviceHistoryApi.load(DEVICE_ID)
    expect(calls.rpc).toHaveBeenCalledTimes(1)
    expect(calls.rpc).toHaveBeenCalledWith('inventory_device_history', { target_device: DEVICE_ID })
    expect(history.assignments).toHaveLength(2)
  })

  it('akzeptiert die Geräte-ID unabhängig von Groß- und Kleinschreibung', async () => {
    const history = await deviceHistoryApi.load(DEVICE_ID.toUpperCase())
    expect(history.device.id).toBe(DEVICE_ID)
  })

  it.each(['', 'IT-0003', 'abc', `${DEVICE_ID}x`])('lehnt die ungültige Geräte-ID „%s“ ohne Netzwerkaufruf ab', async (id) => {
    await expect(deviceHistoryApi.load(id)).rejects.toMatchObject({
      code: 'invalid', message: 'Ungültige Geräteauswahl.',
    })
    expect(calls.getSession).not.toHaveBeenCalled()
    expect(calls.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['42501', 'forbidden', 'Keine Berechtigung für die Gerätehistorie.'],
    ['PGRST301', 'forbidden', 'Keine Berechtigung für die Gerätehistorie.'],
    ['P0002', 'missing', 'Das Gerät wurde nicht gefunden.'],
    ['22023', 'invalid', 'Ungültige Geräteauswahl.'],
    ['PGRST202', 'unavailable', 'Die Gerätehistorie ist derzeit nicht verfügbar. Bitte die Supabase-Funktionen prüfen.'],
    [undefined, 'unavailable', 'Die Gerätehistorie ist derzeit nicht verfügbar. Bitte die Supabase-Funktionen prüfen.'],
  ])('übersetzt den Serverfehler %s in eine deutsche Meldung', async (code, expectedCode, message) => {
    calls.rpc.mockResolvedValue({ data: null, error: { code, message: 'intern' } })
    const error = await deviceHistoryApi.load(DEVICE_ID).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(DeviceHistoryError)
    expect(error).toMatchObject({ code: expectedCode, message })
  })

  it('meldet Netzwerkfehler als nicht verfügbar', async () => {
    calls.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(deviceHistoryApi.load(DEVICE_ID)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('verlangt eine aktive Sitzung', async () => {
    calls.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(deviceHistoryApi.load(DEVICE_ID)).rejects.toMatchObject({
      code: 'unauthorized', message: 'Bitte melde dich erneut an.',
    })
    calls.getSession.mockRejectedValue(new Error('Storage nicht verfügbar'))
    await expect(deviceHistoryApi.load(DEVICE_ID)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(calls.rpc).not.toHaveBeenCalled()
  })

  it('meldet eine fehlende Supabase-Konfiguration als nicht verfügbar', async () => {
    calls.client.current = false
    await expect(deviceHistoryApi.load(DEVICE_ID)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('verwirft ungültige Antworten und Antworten zu einem anderen Gerät', async () => {
    calls.rpc.mockResolvedValue({ data: { device }, error: null })
    await expect(deviceHistoryApi.load(DEVICE_ID)).rejects.toMatchObject({ code: 'invalid_response' })
    calls.rpc.mockResolvedValue({
      data: payload({ device: { ...device, id: '00000000-0000-4000-8000-000000000999' } }), error: null,
    })
    await expect(deviceHistoryApi.load(DEVICE_ID)).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
