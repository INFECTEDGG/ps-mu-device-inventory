import type { DeviceStatus } from './deviceApi'

/** Filter are intentionally kept separate from pagination and write operations. */
export interface DeviceFilters {
  search: string
  deviceType: string
  status: DeviceStatus | 'all' | 'unset'
  employeeId: string
}

export interface DeviceAssignee {
  id: string
  label: string
}

export const EMPTY_DEVICE_FILTERS: DeviceFilters = {
  search: '',
  deviceType: '',
  status: 'all',
  employeeId: '',
}

export function hasActiveDeviceFilters(filters: DeviceFilters): boolean {
  return Boolean(filters.search.trim() || filters.deviceType.trim() ||
    filters.status !== 'all' || filters.employeeId)
}

/**
 * PostgREST's .or() expression uses comma/parentheses as separators.
 * Quoted filter values plus escaped quote/backslash keep user input inside
 * one ILIKE operand. % and _ are escaped as SQL LIKE literals.
 */
export function asQuotedContainsOperand(value: string): string {
  const term = value.trim().replace(/[\\%_]/g, '\\$&')
  return `"%${term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`
}

export function searchOrExpression(search: string): string {
  const operand = asQuotedContainsOperand(search)
  return ['asset_tag', 'serial_number', 'device_type', 'manufacture', 'model', 'name']
    .map((column) => `${column}.ilike.${operand}`)
    .join(',')
}
