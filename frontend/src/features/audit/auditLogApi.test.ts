import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: calls.getSession }, rpc: calls.rpc },
}))

import {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  AuditLogError,
  EMPTY_AUDIT_FILTERS,
  auditLogApi,
  buildAuditRpcArgs,
  isAuditAction,
  isAuditEntityType,
  parseAuditLogPage,
  type AuditLogFilters,
} from './auditLogApi'

const DEVICE_ID = '7d0f0d43-8a3a-4c1e-9d55-0f3c1b6a2e10'

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-11-23T10:15:30.123456+00:00',
  action: 'DEVICE_STATUS_CHANGED',
  entity_type: 'device',
  entity_id: DEVICE_ID,
  entity_title: 'IT-0003',
  user_id: '22222222-2222-4222-8222-222222222222',
  user_name: 'Erika Muster',
  user_email: 'erika@example.invalid',
  details: { old_status: 'available', new_status: 'assigned' },
}

function filters(overrides: Partial<AuditLogFilters> = {}): AuditLogFilters {
  return { ...EMPTY_AUDIT_FILTERS, ...overrides }
}

const noFilterArgs = {
  target_page: 0,
  target_action: null,
  target_entity_type: null,
  target_entity_id: null,
  search_text: null,
  created_from: null,
  created_to: null,
}

describe('Audit-Log – Aktionsliste', () => {
  it('enthält alle 15 Aktionen der Spezifikation in fester Reihenfolge', () => {
    expect(AUDIT_ACTIONS).toEqual([
      'DEVICE_CREATED', 'DEVICE_UPDATED', 'DEVICE_STATUS_CHANGED', 'DEVICE_DELETED',
      'DEVICE_ASSIGNED', 'DEVICE_RETURNED', 'ASSIGNMENT_UPDATED', 'ASSIGNMENT_DELETED',
      'USER_CREATED', 'USER_UPDATED', 'USER_ROLE_CHANGED', 'USER_DISABLED', 'USER_ENABLED', 'USER_DELETED',
      'ROLE_PERMISSIONS_CHANGED',
    ])
    expect(AUDIT_PAGE_SIZE).toBe(25)
  })

  it('erkennt nur bekannte Aktionen und Objekttypen', () => {
    expect(isAuditAction('DEVICE_CREATED')).toBe(true)
    expect(isAuditAction('device_created')).toBe(false)
    expect(isAuditAction('INSERT')).toBe(false)
    expect(isAuditAction(null)).toBe(false)
    expect(isAuditEntityType('role')).toBe(true)
    expect(isAuditEntityType('assignment')).toBe(false)
  })
})

describe('Audit-Log – Antwortvalidierung', () => {
  it('akzeptiert eine gültige Seite und übernimmt genau die RPC-Schlüssel', () => {
    const page = parseAuditLogPage({ total: 1, page_size: 25, items: [{ ...item, extra: 'ignoriert' }] })
    expect(page.total).toBe(1)
    expect(page.page_size).toBe(25)
    expect(page.items[0]).toEqual(item)
    expect(Object.keys(page.items[0]!)).not.toContain('extra')
  })

  it('akzeptiert eine leere Seite', () => {
    expect(parseAuditLogPage({ total: 0, page_size: 25, items: [] })).toEqual({ total: 0, page_size: 25, items: [] })
  })

  it('akzeptiert unbekannte Aktionen und Objekttypen aus Altdaten', () => {
    const page = parseAuditLogPage({ total: 1, page_size: 25,
      items: [{ ...item, action: 'LEGACY_IMPORT', entity_type: 'assignment' }] })
    expect(page.items[0]?.action).toBe('LEGACY_IMPORT')
    expect(page.items[0]?.entity_type).toBe('assignment')
  })

  it('akzeptiert Einträge ohne ausführenden Benutzer (System)', () => {
    const page = parseAuditLogPage({ total: 1, page_size: 25,
      items: [{ ...item, user_id: null, user_name: null, user_email: null, entity_id: null, entity_title: null }] })
    expect(page.items[0]?.user_id).toBeNull()
    expect(page.items[0]?.entity_title).toBeNull()
  })

  it('normalisiert fehlende oder ungewöhnliche Details, ohne Informationen zu verlieren', () => {
    const parse = (details: unknown) => parseAuditLogPage({ total: 1, page_size: 25, items: [{ ...item, details }] })
      .items[0]?.details
    const withoutDetails: Record<string, unknown> = { ...item }
    delete withoutDetails.details
    expect(parseAuditLogPage({ total: 1, page_size: 25, items: [withoutDetails] }).items[0]?.details).toEqual({})
    expect(parse(null)).toEqual({})
    expect(parse({})).toEqual({})
    expect(parse(['a', 'b'])).toEqual({ value: ['a', 'b'] })
    expect(parse('freier Text')).toEqual({ value: 'freier Text' })
    expect(parse(42)).toEqual({ value: 42 })
  })

  it('weist unvollständige oder falsche Serverantworten zurück', () => {
    const invalid: unknown[] = [
      null, undefined, [], 'text', {},
      { total: 1, page_size: 25 },
      { total: -1, page_size: 25, items: [] },
      { total: 1.5, page_size: 25, items: [] },
      { total: '1', page_size: 25, items: [] },
      { total: 0, page_size: 0, items: [] },
      { total: 0, items: [] },
      { total: 2, page_size: 1, items: [item, { ...item, id: 'b' }] },
      { total: 1, page_size: 25, items: [null] },
      { total: 1, page_size: 25, items: [{ ...item, id: '' }] },
      { total: 1, page_size: 25, items: [{ ...item, id: 7 }] },
      { total: 1, page_size: 25, items: [{ ...item, action: '' }] },
      { total: 1, page_size: 25, items: [{ ...item, action: null }] },
      { total: 1, page_size: 25, items: [{ ...item, created_at: null }] },
      { total: 1, page_size: 25, items: [{ ...item, entity_type: null }] },
      { total: 1, page_size: 25, items: [{ ...item, user_name: undefined }] },
      { total: 1, page_size: 25, items: [{ ...item, user_email: 5 }] },
      { total: 1, page_size: 25, items: [{ ...item, entity_id: {} }] },
    ]
    for (const value of invalid) {
      expect(() => parseAuditLogPage(value)).toThrow(AuditLogError)
    }
    try {
      parseAuditLogPage({})
    } catch (error) {
      expect((error as AuditLogError).code).toBe('invalid_response')
    }
  })
})

describe('Audit-Log – RPC-Argumente', () => {
  it('liefert ohne Filter nur Seite und NULL-Werte', () => {
    expect(buildAuditRpcArgs(filters(), 0)).toEqual(noFilterArgs)
    expect(buildAuditRpcArgs(filters(), 3).target_page).toBe(3)
  })

  it('übernimmt Aktion und Objekttyp', () => {
    const args = buildAuditRpcArgs(filters({ action: 'USER_ROLE_CHANGED', entityType: 'user' }), 1)
    expect(args).toMatchObject({ target_page: 1, target_action: 'USER_ROLE_CHANGED', target_entity_type: 'user' })
  })

  it('trimmt die Suche und behandelt leere Suche als keine Suche', () => {
    expect(buildAuditRpcArgs(filters({ search: '  IT-0003  ' }), 0).search_text).toBe('IT-0003')
    expect(buildAuditRpcArgs(filters({ search: '   ' }), 0).search_text).toBeNull()
    expect(buildAuditRpcArgs(filters({ search: '\t\n' }), 0).search_text).toBeNull()
    expect(buildAuditRpcArgs(filters({ search: '100%_sicher' }), 0).search_text).toBe('100%_sicher')
  })

  it('begrenzt die Suche auf 100 Zeichen (Unicode-Zeichen, nach dem Trimmen)', () => {
    expect(buildAuditRpcArgs(filters({ search: `  ${'a'.repeat(100)}  ` }), 0).search_text).toHaveLength(100)
    // 100 Emojis sind 200 UTF-16-Einheiten, aber nur 100 Zeichen wie in PostgreSQL.
    expect(buildAuditRpcArgs(filters({ search: '😀'.repeat(100) }), 0).search_text).toBe('😀'.repeat(100))
    expect(() => buildAuditRpcArgs(filters({ search: 'a'.repeat(101) }), 0)).toThrow(
      expect.objectContaining({ code: 'invalid', field: 'search' }),
    )
  })

  it('lehnt ungültige Seiten ab', () => {
    for (const page of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10001]) {
      expect(() => buildAuditRpcArgs(filters(), page)).toThrow(expect.objectContaining({ code: 'invalid' }))
    }
    expect(buildAuditRpcArgs(filters(), 10000).target_page).toBe(10000)
  })

  it('lehnt unbekannte Aktionen und Objekttypen ab', () => {
    expect(() => buildAuditRpcArgs(filters({ action: 'DROP_TABLE' as AuditLogFilters['action'] }), 0))
      .toThrow(expect.objectContaining({ code: 'invalid', field: 'action' }))
    expect(() => buildAuditRpcArgs(filters({ entityType: 'assignment' as AuditLogFilters['entityType'] }), 0))
      .toThrow(expect.objectContaining({ code: 'invalid', field: 'entityType' }))
  })

  it('schränkt optional auf ein einzelnes Gerät ein', () => {
    const args = buildAuditRpcArgs(filters(), 2, { type: 'device', id: DEVICE_ID })
    expect(args).toEqual({ ...noFilterArgs, target_page: 2, target_entity_type: 'device', target_entity_id: DEVICE_ID })
    expect(buildAuditRpcArgs(filters({ entityType: 'device' }), 0, { type: 'device', id: DEVICE_ID }).target_entity_id)
      .toBe(DEVICE_ID)
  })

  it('lehnt ungültige Objekt-Einschränkungen ab', () => {
    for (const entity of [
      { type: 'device' as const, id: '' },
      { type: 'device' as const, id: 'IT-0003' },
      { type: 'device' as const, id: `${DEVICE_ID}x` },
      { type: 'assignment' as unknown as 'device', id: DEVICE_ID },
    ]) {
      expect(() => buildAuditRpcArgs(filters(), 0, entity)).toThrow(expect.objectContaining({ code: 'invalid' }))
    }
    expect(() => buildAuditRpcArgs(filters({ entityType: 'user' }), 0, { type: 'device', id: DEVICE_ID }))
      .toThrow(expect.objectContaining({ code: 'invalid', field: 'entityType' }))
  })

  it('lehnt ungültige oder unvollständige Datumswerte ab', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-31', '2026-11', '23.11.2026',
      '2026-11-23T10:00', '0099-01-01', 'gestern', '2026-1-5']) {
      expect(() => buildAuditRpcArgs(filters({ from: value }), 0), value)
        .toThrow(expect.objectContaining({ code: 'invalid', field: 'from' }))
      expect(() => buildAuditRpcArgs(filters({ to: value }), 0), value)
        .toThrow(expect.objectContaining({ code: 'invalid', field: 'to' }))
    }
    expect(buildAuditRpcArgs(filters({ from: '2028-02-29' }), 0).created_from).not.toBeNull()
  })

  it('lehnt einen Zeitraum ab, dessen Beginn nach dem Ende liegt', () => {
    expect(() => buildAuditRpcArgs(filters({ from: '2026-11-24', to: '2026-11-23' }), 0))
      .toThrow(expect.objectContaining({ code: 'invalid', field: 'from' }))
    const sameDay = buildAuditRpcArgs(filters({ from: '2026-11-23', to: '2026-11-23' }), 0)
    expect(new Date(sameDay.created_from!).getTime()).toBeLessThan(new Date(sameDay.created_to!).getTime())
  })

  it('setzt Beginn und Ende des Tages in lokaler Zeit; das Ende ist inklusive', () => {
    const args = buildAuditRpcArgs(filters({ from: '2026-11-01', to: '2026-11-23' }), 0)
    const from = new Date(args.created_from!)
    expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes(),
      from.getSeconds(), from.getMilliseconds()]).toEqual([2026, 10, 1, 0, 0, 0, 0])
    expect(args.created_from).toBe(new Date(2026, 10, 1, 0, 0, 0, 0).toISOString())
    expect(args.created_to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:59\.999999Z$/)
    const to = new Date(args.created_to!)
    expect([to.getFullYear(), to.getMonth(), to.getDate(), to.getHours(), to.getMinutes(), to.getSeconds()])
      .toEqual([2026, 10, 23, 23, 59, 59])
    // Eine Millisekunde später beginnt bereits der Folgetag.
    expect(new Date(to.getTime() + 1).getDate()).toBe(24)
  })

  it('akzeptiert einzelne Zeitraumgrenzen', () => {
    expect(buildAuditRpcArgs(filters({ from: '2026-11-01' }), 0).created_to).toBeNull()
    expect(buildAuditRpcArgs(filters({ to: '2026-11-01' }), 0).created_from).toBeNull()
  })
})

describe('Audit-Log – Zeitraum in deutscher Zeitzone', () => {
  const originalTimeZone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Europe/Berlin' })
  afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
  })

  it('rechnet Winterzeit (UTC+1) korrekt um', () => {
    const args = buildAuditRpcArgs(filters({ from: '2026-11-23', to: '2026-11-23' }), 0)
    expect(args.created_from).toBe('2026-11-22T23:00:00.000Z')
    expect(args.created_to).toBe('2026-11-23T22:59:59.999999Z')
  })

  it('rechnet Sommerzeit (UTC+2) korrekt um', () => {
    const args = buildAuditRpcArgs(filters({ from: '2026-07-01', to: '2026-07-31' }), 0)
    expect(args.created_from).toBe('2026-06-30T22:00:00.000Z')
    expect(args.created_to).toBe('2026-07-31T21:59:59.999999Z')
  })

  it('berücksichtigt den Tag der Zeitumstellung', () => {
    // 29.03.2026: Umstellung auf Sommerzeit – Tagesbeginn noch UTC+1, Tagesende bereits UTC+2.
    const args = buildAuditRpcArgs(filters({ from: '2026-03-29', to: '2026-03-29' }), 0)
    expect(args.created_from).toBe('2026-03-28T23:00:00.000Z')
    expect(args.created_to).toBe('2026-03-29T21:59:59.999999Z')
  })
})

describe('Audit-Log – Supabase-Aufruf', () => {
  beforeEach(() => {
    calls.rpc.mockReset()
    calls.getSession.mockReset()
    calls.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
  })

  it('ruft ausschließlich den abgesicherten RPC mit allen Argumenten auf', async () => {
    calls.rpc.mockResolvedValue({ data: { total: 1, page_size: 25, items: [item] }, error: null })
    const page = await auditLogApi.list(filters({ action: 'DEVICE_STATUS_CHANGED', search: ' IT ' }), 1)
    expect(calls.rpc).toHaveBeenCalledTimes(1)
    expect(calls.rpc).toHaveBeenCalledWith('inventory_audit_log_list', {
      ...noFilterArgs, target_page: 1, target_action: 'DEVICE_STATUS_CHANGED', search_text: 'IT',
    })
    expect(page.items[0]?.entity_title).toBe('IT-0003')
  })

  it('übergibt die Geräte-Einschränkung', async () => {
    calls.rpc.mockResolvedValue({ data: { total: 0, page_size: 25, items: [] }, error: null })
    await auditLogApi.list(EMPTY_AUDIT_FILTERS, 0, { type: 'device', id: DEVICE_ID })
    expect(calls.rpc).toHaveBeenCalledWith('inventory_audit_log_list', {
      ...noFilterArgs, target_entity_type: 'device', target_entity_id: DEVICE_ID,
    })
  })

  it.each([
    ['42501', 'forbidden', 'Keine Berechtigung für das Audit-Log.'],
    ['PGRST301', 'forbidden', 'Keine Berechtigung für das Audit-Log.'],
    ['22023', 'invalid', 'Ungültige Filterauswahl.'],
    ['PGRST202', 'unavailable', 'Das Audit-Log ist derzeit nicht verfügbar. Bitte die Supabase-Funktionen prüfen.'],
    [undefined, 'unavailable', 'Das Audit-Log ist derzeit nicht verfügbar. Bitte die Supabase-Funktionen prüfen.'],
  ])('ordnet den Fehlercode %s der Meldung „%s“ zu', async (code, expectedCode, message) => {
    calls.rpc.mockResolvedValue({ data: null, error: { code, message: 'intern' } })
    await expect(auditLogApi.list(EMPTY_AUDIT_FILTERS, 0)).rejects.toMatchObject({ code: expectedCode, message })
  })

  it('meldet Netzwerkfehler als nicht verfügbar', async () => {
    calls.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(auditLogApi.list(EMPTY_AUDIT_FILTERS, 0)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('weist ungültige Serverantworten zurück', async () => {
    calls.rpc.mockResolvedValue({ data: [{ total: 1 }], error: null })
    await expect(auditLogApi.list(EMPTY_AUDIT_FILTERS, 0)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('verlangt eine Sitzung und ruft ohne Sitzung keinen RPC auf', async () => {
    calls.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(auditLogApi.list(EMPTY_AUDIT_FILTERS, 0)).rejects.toMatchObject({
      code: 'unauthorized', message: 'Bitte melde dich erneut an.',
    })
    calls.getSession.mockRejectedValue(new Error('Speicher nicht verfügbar'))
    await expect(auditLogApi.list(EMPTY_AUDIT_FILTERS, 0)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(calls.rpc).not.toHaveBeenCalled()
  })

  it('prüft die Filter vor jedem Netzwerkzugriff', async () => {
    await expect(auditLogApi.list(filters({ from: '2026-02-30' }), 0)).rejects.toBeInstanceOf(AuditLogError)
    await expect(auditLogApi.list(EMPTY_AUDIT_FILTERS, -1)).rejects.toMatchObject({ code: 'invalid' })
    expect(calls.getSession).not.toHaveBeenCalled()
    expect(calls.rpc).not.toHaveBeenCalled()
  })
})
