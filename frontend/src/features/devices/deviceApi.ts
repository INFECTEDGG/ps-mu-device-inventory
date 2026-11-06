import { supabase } from '../../lib/supabase'

export class DeviceApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

export interface NewDeviceInput {
  asset_tag: string
  device_type: string
  manufacture: string
  model: string
  serial_number: string
  name?: string
  operating_system?: string
  processor?: string
  ram_gb?: number
  disk_space_gb?: number
  location?: string
  device_usage?: string
  purchased_at?: string
  start_of_use?: string
  maintenance_end?: string
  description?: string
  comments?: string
}

const safeMessages: Record<string, string> = {
  unavailable: 'Die Geräteverwaltung ist derzeit nicht verfügbar.',
  unauthorized: 'Bitte erneut anmelden.',
  forbidden: 'Keine Berechtigung, Geräte anzulegen.',
  duplicate: 'Geräte-ID oder Seriennummer wird bereits verwendet.',
}

export const deviceApi = {
  // Neu für PBI-06: schlägt die nächste freie Geräte-ID im Format IT-0001 vor.
  async suggestNextAssetTag(): Promise<string> {
    if (!supabase) return 'IT-0001'
    const { data, error } = await supabase
      .from('devices')
      .select('asset_tag')
      .ilike('asset_tag', 'IT-%')
    if (error || !data) return 'IT-0001'
    const numbers = data
      .map((row: { asset_tag: string }) => Number.parseInt(row.asset_tag.slice(3), 10))
      .filter((value: number) => Number.isInteger(value) && value > 0)
    const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1
    return `IT-${String(next).padStart(4, '0')}`
  },
  async create(input: NewDeviceInput, createdBy: string) {
    if (!supabase)
      throw new DeviceApiError(safeMessages.unavailable, 'unavailable')
    const { data: auth, error: authError } = await supabase.auth.getSession()
    if (authError || !auth.session)
      throw new DeviceApiError(safeMessages.unauthorized, 'unauthorized')

    // Leere optionale Felder als NULL speichern statt als leeren String.
    const { error } = await supabase.from('devices').insert({
      asset_tag: input.asset_tag.trim(),
      device_type: input.device_type.trim(),
      manufacture: input.manufacture.trim(),
      model: input.model.trim(),
      serial_number: input.serial_number.trim(),
      name: input.name?.trim() || null,
      operating_system: input.operating_system?.trim() || null,
      processor: input.processor?.trim() || null,
      ram_gb: input.ram_gb ?? null,
      disk_space_gb: input.disk_space_gb ?? null,
      location: input.location?.trim() || null,
      device_usage: input.device_usage?.trim() || null,
      purchased_at: input.purchased_at || null,
      start_of_use: input.start_of_use || null,
      maintenance_end: input.maintenance_end || null,
      description: input.description?.trim() || null,
      comments: input.comments?.trim() || null,
      created_by: createdBy,
    })

    if (error) {
      // Postgres-Code 23505 = unique_violation (asset_tag/serial_number doppelt).
      const code = error.code === '23505' ? 'duplicate' : 'unavailable'
      throw new DeviceApiError(safeMessages[code] ?? safeMessages.unavailable, code)
    }
  },
}
