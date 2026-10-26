import { supabase } from '../lib/supabase'
import type { InventorySessionClient } from '../lib/serverSession'
import { createBoundSessionClient } from '../lib/sessionRpcClient'

export function createInventorySessionClient(sessionId: string): InventorySessionClient | null {
  const client = supabase
  if (!client) return null
  return createBoundSessionClient({
    getSession: () => client.auth.getSession().then(({ data, error }) => ({ session: data.session, error })),
    rpc: (name, authorization) => client.rpc(name)
      .setHeader('Authorization', authorization)
      .then(({ data, error }) => ({ data, error })),
  }, sessionId)
}
