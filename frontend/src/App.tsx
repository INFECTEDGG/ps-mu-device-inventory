
import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { navigationEntries } from './config/navigation'
import { hasPermission, type Role } from './config/permissions'
import { useAppNavigation } from './hooks/useAppNavigation'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

interface AppProps {
  role?: Role | null
  isRoleLoading?: boolean
  roleError?: string | null
}

export default function App({
  role = null,
  isRoleLoading = false,
  roleError = null,
}: AppProps) {
  const { currentPath, navigate } = useAppNavigation()

  const currentPage = navigationEntries.find(
    (entry) => entry.path === currentPath
  )

  // Prüfen, ob der Benutzer diese Seite öffnen darf.
  const hasAccess = currentPage
    ? hasPermission(role, currentPage.requiredPermission)
    : false

  useEffect(() => {
    document.title = `${
      currentPage?.label ?? 'Seite nicht gefunden'
    } | Device Inventory`

    requestAnimationFrame(() =>
      document.getElementById('page-title')?.focus()
    )
  }, [currentPage])

  return (
    <AppLayout
      currentPage={currentPage?.label ?? 'Nicht gefunden'}
      currentPath={currentPath}
      onNavigate={navigate}
      role={role}
    >
      {!currentPage ? (
        <NotFoundPage onNavigate={navigate} />
      ) : isRoleLoading ? (
        <section aria-labelledby="page-title" aria-live="polite">
          <h1 id="page-title" tabIndex={-1}>
            Berechtigungen werden geladen
          </h1>
          <p>Bitte warten, während deine Benutzerrolle geprüft wird.</p>
        </section>
      ) : roleError ? (
        <section aria-labelledby="page-title" role="alert">
          <h1 id="page-title" tabIndex={-1}>
            Fehler beim Laden
          </h1>
          <p>
            Deine Berechtigungen konnten nicht geladen werden.
          </p>
        </section>
      ) : hasAccess ? (
        <PlaceholderPage page={currentPage} />
      ) : (
        <section aria-labelledby="page-title">
          <h1 id="page-title" tabIndex={-1}>
            Zugriff verweigert
          </h1>
          <p>
            Du hast keine Berechtigung, diese Seite aufzurufen.
          </p>
        </section>
      )}
    </AppLayout>
  )
}
