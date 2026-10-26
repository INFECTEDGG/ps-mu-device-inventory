import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function createSupabaseClient() {
  if (!supabaseUrl || !supabasePublishableKey) return null

  try {
    return createClient(supabaseUrl, supabasePublishableKey, {
      auth: { detectSessionInUrl: false },
      global: {
        fetch: (input, init) => fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
        }),
      },
    })
  } catch {
    return null
  }
}

export const supabase = createSupabaseClient()
