
import type { SupabaseClient } from '@supabase/supabase-js'
import { useUserRole } from './hooks/useUserRole'
import App from './App'

interface RoleAwareAppProps {
  supabase: SupabaseClient
  userId: string | null
}

export function RoleAwareApp({
  supabase,
  userId,
}: RoleAwareAppProps) {

  // Benutzerrolle automatisch über unseren Hook laden
  const { role, isLoading, error } = useUserRole(
    supabase,
    userId
  )

  // Rolle und Ladezustand an die Anwendung übergeben
  return (
    <App
      role={role}
      isRoleLoading={isLoading}
      roleError={error}
    />
  )
}
