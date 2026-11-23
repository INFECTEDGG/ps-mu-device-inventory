import { supabase } from '../../lib/supabase'

export interface AssignmentCandidate {
  user_id: string
  display_name: string
  email: string
}

export class AssignmentApiError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

const messages: Record<string, string> = {
  unavailable: 'Die Gerätezuweisung ist derzeit nicht verfügbar. Bitte die Supabase-Funktionen prüfen.',
  unauthorized: 'Bitte melde dich erneut an.',
  forbidden: 'Keine Berechtigung, Geräte zuzuweisen.',
  conflict: 'Das Gerät ist nicht mehr verfügbar oder bereits zugewiesen. Bitte die Liste neu laden.',
  missing: 'Gerät oder Mitarbeiter wurde nicht gefunden beziehungsweise ist nicht mehr aktiv.',
  invalid: 'Bitte ein Gerät und einen Mitarbeiter auswählen.',
  invalid_response: 'Die Mitarbeiterliste enthält ungültige Daten.',
}

function asError(code: string) {
  return new AssignmentApiError(messages[code] ?? messages.unavailable, code)
}

function classify(code?: string) {
  if (code === '42501' || code === 'PGRST301') return asError('forbidden')
  if (code === '23505' || code === '23514') return asError('conflict')
  if (code === 'P0002') return asError('missing')
  if (code === '22023') return asError('invalid')
  return asError('unavailable')
}

async function requireSession() {
  if (!supabase) throw asError('unavailable')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw asError('unauthorized')
  return supabase
}

export const assignmentApi = {
  async candidates(): Promise<AssignmentCandidate[]> {
    const db = await requireSession()
    const { data, error } = await db.rpc('inventory_assignment_candidates')
    if (error) throw classify(error.code)
    if (!Array.isArray(data) || data.some(row => !row ||
      typeof row.user_id !== 'string' ||
      typeof row.display_name !== 'string' ||
      typeof row.email !== 'string')) throw asError('invalid_response')
    return data as AssignmentCandidate[]
  },

  async assign(deviceId: string, employeeId: string): Promise<void> {
    if (!deviceId || !employeeId) throw asError('invalid')
    const db = await requireSession()
    const { error } = await db.rpc('inventory_assign_device', {
      target_device: deviceId,
      target_employee: employeeId,
    })
    if (error) throw classify(error.code)
  },
}
