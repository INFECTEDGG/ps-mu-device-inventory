import { deviceApi, type DeviceStatus } from '../devices/deviceApi'
import { EMPTY_DEVICE_FILTERS } from '../devices/deviceFilters'

/** Dashboard counts are scoped with exactly the same rules as the device list. */
export interface DeviceDashboardCounts {
  total: number
  available: number
  assigned: number
  defective: number
  maintenance: number
  retired: number
  unset: number
}

export class DashboardApiError extends Error {
  constructor(message: string) { super(message) }
}

export function asSafeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DashboardApiError('Der Gerätebestand konnte nicht vollständig geladen werden.')
  }
  return value
}

export const dashboardApi = {
  async counts(userId: string, canViewAll: boolean): Promise<DeviceDashboardCounts> {
    if (!userId) throw new DashboardApiError('Bitte melde dich erneut an.')
    // deviceApi.list restricts an employee to active assignments. We never
    // query global device counts for a user lacking devices:view_all.
    const statuses: Array<DeviceStatus | 'unset' | 'all'> = [
      'all', 'available', 'assigned', 'defective', 'maintenance', 'retired', 'unset',
    ]
    const counts = await Promise.all(statuses.map(async status => {
      const result = await deviceApi.list(userId, canViewAll, 0, {
        ...EMPTY_DEVICE_FILTERS, status,
      })
      return asSafeCount(result.total)
    }))
    const [total, available, assigned, defective, maintenance, retired, unset] = counts
    return { total, available, assigned, defective, maintenance, retired, unset }
  },
}
