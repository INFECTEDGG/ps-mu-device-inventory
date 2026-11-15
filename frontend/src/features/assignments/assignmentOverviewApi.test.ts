import { describe, expect, it } from 'vitest'
import { AssignmentOverviewError, parseOverview } from './assignmentOverviewApi'

const record = {
  assignment_id: 'a', device_id: 'd', asset_tag: 'IT-0003', device_type: 'Laptop',
  model: 'ThinkPad', employee_id: 'e', employee_name: 'Test Mitarbeiter',
  employee_email: 'test@example.com', assigned_by_name: 'Administrator',
  returned_by_name: null, assigned_at: '2026-11-15T12:00:00Z', returned_at: null,
}

describe('Zuweisungsübersicht – Antwortvalidierung', () => {
  it('akzeptiert eine aktive Zuweisung mit Zählerwerten', () => {
    const result = parseOverview({ active_count: 1, returned_count: 0, total: 1, items: [record] })
    expect(result.items[0]?.asset_tag).toBe('IT-0003')
    expect(result.active_count).toBe(1)
  })
  it('akzeptiert eine zurückgegebene Zuweisung', () => {
    const result = parseOverview({ active_count: 0, returned_count: 1, total: 1,
      items: [{ ...record, returned_at: '2026-11-15T13:00:00Z', returned_by_name: 'Administrator' }] })
    expect(result.items[0]?.returned_by_name).toBe('Administrator')
  })
  it('weist unvollständige oder falsche Serverantworten zurück', () => {
    for (const invalid of [null, [], {}, { active_count: -1, returned_count: 0, total: 0, items: [] },
      { active_count: 1, returned_count: 0, total: 1, items: [{ ...record, employee_email: null }] }]) {
      expect(() => parseOverview(invalid)).toThrow(AssignmentOverviewError)
    }
  })
})
