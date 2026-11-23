import { hasPermission, type Permission, type Role } from '../../config/permissions'
import type { DeviceStatus } from './deviceApi'

// Reine UI-Vorauswahl. Die endgültige Prüfung erfolgt immer serverseitig.
export function isDeviceAssignable(status: DeviceStatus | null): boolean {
  return status === 'available'
}

export function mayAssignDevices(role: Role | null | undefined, permissions?: readonly Permission[] | null): boolean {
  return (role === 'admin' || role === 'super_admin' || role === 'device_manager')
    && hasPermission(role, 'assignments:manage', permissions)
}
