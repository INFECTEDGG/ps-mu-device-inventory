import { getSupabaseSessionId } from './sessionKey.ts'
import { ServerSessionError, type InventorySessionClient } from './serverSession.ts'

interface SessionToken {
  access_token: string
  user: { id: string }
}

export interface SessionRpcTransport {
  getSession(): PromiseLike<{ session: SessionToken | null; error: unknown }>
  rpc(name: string, authorization: string): PromiseLike<{ data: unknown; error: unknown }>
}

export function createBoundSessionClient(transport: SessionRpcTransport, sessionId: string): InventorySessionClient {
  return {
    async rpc(name) {
      try {
        const { session, error } = await transport.getSession()
        if (error || !session || getSupabaseSessionId(session) !== sessionId) throw new ServerSessionError()
        // Diesen Token beibehalten, auch wenn ein anderer Tab inzwischen neu angemeldet wird.
        return await transport.rpc(name, `Bearer ${session.access_token}`)
      } catch {
        throw new ServerSessionError()
      }
    },
  }
}
