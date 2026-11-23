import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: calls.getSession }, rpc: calls.rpc },
}))

import { assignmentApi, AssignmentApiError } from './assignmentApi'

describe('Gerätezuweisung – Supabase-Aufrufe', () => {
  beforeEach(() => {
    calls.rpc.mockReset()
    calls.getSession.mockReset()
    calls.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
  })

  it('verwendet nur den abgesicherten Zuweisungs-RPC', async () => {
    calls.rpc.mockResolvedValue({ error: null })
    await assignmentApi.assign('geraete-uuid', 'mitarbeiter-uuid')
    expect(calls.rpc).toHaveBeenCalledWith('inventory_assign_device', {
      target_device: 'geraete-uuid', target_employee: 'mitarbeiter-uuid',
    })
  })

  it('ordnet eine Doppelzuweisung dem Konflikt zu', async () => {
    calls.rpc.mockResolvedValue({ error: { code: '23505' } })
    await expect(assignmentApi.assign('device', 'employee')).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('liefert aktive Kandidaten über einen eigenen RPC', async () => {
    const candidates = [{ user_id: 'eins', display_name: 'Max Muster', email: 'max@example.com' }]
    calls.rpc.mockResolvedValue({ data: candidates, error: null })
    expect(await assignmentApi.candidates()).toEqual(candidates)
    expect(calls.rpc).toHaveBeenCalledWith('inventory_assignment_candidates')
  })

  it('verhindert Aktionen ohne Sitzung', async () => {
    calls.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(assignmentApi.assign('device', 'employee')).rejects.toBeInstanceOf(AssignmentApiError)
    expect(calls.rpc).not.toHaveBeenCalled()
  })
})
