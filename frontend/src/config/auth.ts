// Erst zusammen mit der SQL-Migration aktivieren. Den Zugriff prüft die Datenbank.
export const serverSessionGuardEnabled = import.meta.env.VITE_SERVER_SESSION_GUARD === 'true'

// Aktivieren, sobald die SuperAdmin-Rollenmigration in Supabase installiert ist.
export const dynamicRolePermissionsEnabled = import.meta.env.VITE_DYNAMIC_ROLE_PERMISSIONS === 'true'
