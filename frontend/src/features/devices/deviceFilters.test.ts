import { describe, expect, it } from 'vitest'
import { asQuotedContainsOperand, hasActiveDeviceFilters, searchOrExpression, EMPTY_DEVICE_FILTERS } from './deviceFilters'

describe('Gerätefilter', () => {
  it('erkennt angewandte Filter korrekt', () => {
    expect(hasActiveDeviceFilters(EMPTY_DEVICE_FILTERS)).toBe(false)
    expect(hasActiveDeviceFilters({ ...EMPTY_DEVICE_FILTERS, status: 'defective' })).toBe(true)
    expect(hasActiveDeviceFilters({ ...EMPTY_DEVICE_FILTERS, employeeId: 'abc' })).toBe(true)
    expect(hasActiveDeviceFilters({ ...EMPTY_DEVICE_FILTERS, search: '  ' })).toBe(false)
  })
  it('maskiert Platzhalter und reservierte Trennzeichen vor PostgREST OR', () => {
    expect(asQuotedContainsOperand('  IT-0003  ')).toBe('"%IT-0003%"')
    expect(asQuotedContainsOperand('A,B)')).toBe('"%A,B)%"')
    expect(asQuotedContainsOperand('foo%_')).toContain('\\\\%\\\\_')
    expect(asQuotedContainsOperand('test"abc')).toContain('\\"')
  })
  it('durchsucht alle relevanten Stammdatenfelder', () => {
    const expr = searchOrExpression('ThinkPad')
    for (const name of ['asset_tag', 'serial_number', 'device_type', 'manufacture', 'model', 'name']) {
      expect(expr).toContain(`${name}.ilike."%ThinkPad%"`)
    }
  })
})
