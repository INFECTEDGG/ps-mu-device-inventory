import { supabase } from '../../lib/supabase'

export class DeviceApiError extends Error {
  constructor(message: string, readonly code: string) {
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

export type DeviceStatus = 'available' | 'assigned' | 'defective' | 'maintenance' | 'retired'

export interface DeviceRecord extends NewDeviceInput {
  id: string
  status: DeviceStatus
  created_at: string | null
  updated_at?: string | null
}

export interface DevicePage {
  devices: DeviceRecord[]
  total: number
}

const PAGE_SIZE = 10

const safeMessages: Record<string, string> = {
  unavailable: 'Die Geräteverwaltung ist derzeit nicht verfügbar.',
  unauthorized: 'Bitte erneut anmelden.',
  forbidden: 'Keine Berechtigung für diese Geräteaktion.',
  duplicate: 'Geräte-ID oder Seriennummer wird bereits verwendet.',
  invalid: 'Bitte die Pflichtfelder vollständig ausfüllen.',
  missing: 'Das Gerät wurde nicht gefunden oder ist nicht mehr zugänglich.',
}

function errorFor(code: string): DeviceApiError {
  return new DeviceApiError(safeMessages[code] ?? safeMessages.unavailable, code)
}

function classifyError(code: string | undefined): DeviceApiError {
  if (code === '23505') return errorFor('duplicate')
  if (code === '42501' || code === 'PGRST301') return errorFor('forbidden')
  return errorFor('unavailable')
}

async function requireSession() {
  if (!supabase) throw errorFor('unavailable')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw errorFor('unauthorized')
  return supabase
}

function normalizedInput(input: NewDeviceInput) {
  const data = {
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
  }
  if (!data.asset_tag || !data.device_type || !data.manufacture || !data.model || !data.serial_number) {
    throw errorFor('invalid')
  }
  return data
}

export const deviceApi = {
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
    const next = (numbers.length ? Math.max(...numbers) : 0) + 1
    return `IT-${String(next).padStart(4, '0')}`
  },

  // Die Zuordnung wird für Mitarbeiter vorab geprüft. Die RLS-Policies der
  // Datenbank bleiben die maßgebliche Sicherheitsgrenze.
  async list(userId: string, canViewAll: boolean, page = 0): Promise<DevicePage> {
    const db = await requireSession()
    if (!userId) throw errorFor('unauthorized')
    let ids: string[] | null = null
    if (!canViewAll) {
      const assignments = await db
        .from('assignments')
        .select('device_id')
        .eq('employee_id', userId)
        .is('returned_at', null)
      if (assignments.error) throw classifyError(assignments.error.code)
      ids = [...new Set((assignments.data ?? []).map((item: { device_id: string }) => item.device_id))]
      if (!ids.length) return { devices: [], total: 0 }
    }

    const offset = Math.max(0, page) * PAGE_SIZE
    let query = db.from('devices')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (ids) query = query.in('id', ids)
    const { data, error, count } = await query
    if (error) throw classifyError(error.code)
    return { devices: (data ?? []) as DeviceRecord[], total: count ?? 0 }
  },

  async create(input: NewDeviceInput, createdBy: string): Promise<void> {
    const db = await requireSession()
    if (!createdBy) throw errorFor('unauthorized')
    const { error } = await db.from('devices').insert({
      ...normalizedInput(input),
      created_by: createdBy,
    })
    if (error) throw classifyError(error.code)
  },

  // Der Status wird bei Aufgabe 6 bearbeitet, nicht über die Stammdatenmaske.
  async update(id: string, input: NewDeviceInput): Promise<void> {
    const db = await requireSession()
    if (!id) throw errorFor('missing')
    const { data, error } = await db.from('devices')
      .update(normalizedInput(input))
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) throw classifyError(error.code)
    if (!data) throw errorFor('missing')
  },
}

export const DEVICE_PAGE_SIZE = PAGE_SIZE
