import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deviceApi } from '../devices/deviceApi'
import { dashboardApi, asSafeCount, DashboardApiError } from './dashboardApi'

vi.mock('../devices/deviceApi', () => ({ deviceApi: { list: vi.fn() } }))

beforeEach(() => { vi.resetAllMocks() })

describe('Device dashboard', () => {
  it('accepts zero and positive integer counts', () => {
    expect(asSafeCount(0)).toBe(0)
    expect(asSafeCount(25)).toBe(25)
  })
  it('rejects negative and fractional counts', () => {
    expect(() => asSafeCount(-1)).toThrow(DashboardApiError)
    expect(() => asSafeCount(1.2)).toThrow(DashboardApiError)
  })
  it('applies own-device scope to every count when devices:view_all is absent', async () => {
    vi.mocked(deviceApi.list).mockResolvedValue({ devices: [], total: 2 })
    const result = await dashboardApi.counts('employee-user', false)
    expect(result.total).toBe(2)
    expect(deviceApi.list).toHaveBeenCalledTimes(7)
    for (const [userId, all] of vi.mocked(deviceApi.list).mock.calls) {
      expect(userId).toBe('employee-user')
      expect(all).toBe(false)
    }
  })
  it('rejects a missing user ID before querying the inventory', async () => {
    await expect(dashboardApi.counts('', true)).rejects.toThrow(DashboardApiError)
    expect(deviceApi.list).not.toHaveBeenCalled()
  })
})
