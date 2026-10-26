// Erst zusammen mit der SQL-Migration aktivieren. Den Zugriff prüft die Datenbank.
export const serverSessionGuardEnabled = import.meta.env.VITE_SERVER_SESSION_GUARD === 'true'
