import { supabase } from '../../lib/supabase'

export type AssignmentView = 'active' | 'returned'

export interface AssignmentOverviewItem {
  assignment_id: string
  device_id: string
  asset_tag: string
  device_type: string
  model: string
  employee_id: string
  employee_name: string
  employee_email: string
  assigned_by_name: string
  returned_by_name: string | null
  assigned_at: string
  returned_at: string | null
}

export interface AssignmentOverview {
  active_count: number
  returned_count: number
  total: number
  items: AssignmentOverviewItem[]
}

export const ASSIGNMENTS_PAGE_SIZE = 10

export class AssignmentOverviewError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

function errorFor(code?: string): AssignmentOverviewError {
  if (code === '42501' || code === 'PGRST301')
    return new AssignmentOverviewError('Keine Berechtigung für die Zuweisungsverwaltung.', 'forbidden')
  if (code === 'P0002')
    return new AssignmentOverviewError('Diese Zuweisung ist nicht mehr vorhanden.', 'missing')
  if (code === '23514' || code === '23505')
    return new AssignmentOverviewError('Das Gerät wurde bereits zurückgegeben oder sein Status hat sich geändert. Bitte aktualisieren.', 'conflict')
  if (code === '22023')
    return new AssignmentOverviewError('Ungültige Zuweisung oder Filterauswahl.', 'invalid')
  return new AssignmentOverviewError('Die Zuweisungsverwaltung ist derzeit nicht verfügbar. Bitte die Supabase-Funktionen prüfen.', 'unavailable')
}

async function requireSession() {
  if (!supabase) throw errorFor()
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new AssignmentOverviewError('Bitte melde dich erneut an.', 'unauthorized')
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseOverview(value: unknown): AssignmentOverview {
  if (!isRecord(value) || !Array.isArray(value.items) ||
      !['active_count', 'returned_count', 'total'].every(key =>
        Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)) {
    throw new AssignmentOverviewError('Ungültige Antwort der Zuweisungsverwaltung.', 'invalid_response')
  }
  const items = value.items
  if (items.some(item => !isRecord(item) ||
      !['assignment_id', 'device_id', 'asset_tag', 'device_type', 'model',
        'employee_id', 'employee_name', 'employee_email', 'assigned_by_name', 'assigned_at']
        .every(key => typeof item[key] === 'string') ||
      !(item.returned_at === null || typeof item.returned_at === 'string') ||
      !(item.returned_by_name === null || typeof item.returned_by_name === 'string'))) {
    throw new AssignmentOverviewError('Ungültige Zuweisungsdaten empfangen.', 'invalid_response')
  }
  return value as unknown as AssignmentOverview
}

export const assignmentOverviewApi = {
  async list(view: AssignmentView, page: number): Promise<AssignmentOverview> {
    if (!Number.isSafeInteger(page) || page < 0) throw errorFor('22023')
    const db = await requireSession()
    const { data, error } = await db.rpc('inventory_assignments_overview', {
      target_state: view,
      target_page: page,
    })
    if (error) throw errorFor(error.code)
    return parseOverview(data)
  },
  async returnDevice(assignmentId: string): Promise<void> {
    if (!assignmentId) throw errorFor('22023')
    const db = await requireSession()
    const { error } = await db.rpc('inventory_return_device', {
      target_assignment: assignmentId,
    })
    if (error) throw errorFor(error.code)
  },
}
