import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Supabase-Konfiguration fehlt. Prüfe VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey)
