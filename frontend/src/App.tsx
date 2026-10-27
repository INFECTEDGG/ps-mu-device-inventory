
import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { PageContainer } from './components/ui/PageContainer'
import { PageHeader } from './components/ui/PageHeader'
import { navigationEntries } from './config/navigation'
import { hasPermission } from './config/permissions'
import { useAppNavigation } from './hooks/useAppNavigation'
import { useAuthSession } from './hooks/useAuthSession'
import { AccountAccessPage } from './pages/AccountAccessPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { UserManagementPage } from './features/users/UserManagementPage'

export default function App() {
  // Authentifizierung und Benutzerrolle über Micha
  const {
    session,
    role,
    isLoading,
    isRoleLoading,
    profileError,
    reloadProfile,
  } = useAuthSession()

  // Bestehende Navigation
  const { currentPath, navigate } = useAppNavigation()

  const currentPage = navigationEntries.find(
    (entry) => entry.path === currentPath,
  )

  // RBAC: Prüfen, ob die Benutzerrolle
  // die erforderliche Seitenberechtigung besitzt.
  const hasAccess = currentPage
    ? hasPermission(role, currentPage.requiredPermission)
    : false

  // Während Authentifizierung und Rollenprüfung
  // keine geschützten Inhalte anzeigen.
  const isChecking =
    isLoading || (session !== null && isRoleLoading)

  const title = isChecking
    ? 'Sitzung wird geprüft'
    : profileError
      ? 'Zugriff noch nicht möglich'
      : !session || currentPath === '/login'
        ? 'Anmelden'
        : currentPage && !hasAccess
          ? 'Zugriff verweigert'
          : currentPage?.label ?? 'Seite nicht gefunden'

  useEffect(() => {
    document.title = `${title} | Device Inventory`

    const frame = requestAnimationFrame(() => {
      document.getElementById('page-title')?.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [title, currentPath])

  // Sitzung oder Rolle wird geladen.
  if (isChecking) {
    return (
      <main className="login-page" aria-busy="true">
        <p role="status">
          {isLoading
            ? 'Sitzung wird geprüft …'
            : 'Zugriffsberechtigungen werden geprüft …'}
        </p>
      </main>
    )
  }

  // Kein angemeldeter Benutzer: Login anzeigen.
  if (!session) {
    return <LoginPage />
  }

  // Benutzerprofil oder Rolle konnte nicht geladen werden.
  if (profileError) {
    return (
      <AccountAccessPage
        message={profileError}
        onRetry={reloadProfile}
      />
    )
  }

  // Login-Seite separat behandeln.
  if (currentPath === '/login') {
    return <LoginPage />
  }

  // Geschützte Anwendung.
  return (
    <AppLayout
      currentPage={currentPage?.label ?? 'Nicht gefunden'}
      currentPath={currentPath}
      onNavigate={navigate}
      role={role}
    >
      {!currentPage ? (
        <NotFoundPage onNavigate={navigate} />
      ) : !hasAccess ? (
        <PageContainer>
          <PageHeader
            title="Zugriff verweigert"
            description="Du hast keine Berechtigung, diese Seite aufzurufen."
          />
        </PageContainer>
      ) : currentPath === '/benutzerverwaltung' ? (
        <UserManagementPage />
      ) : (
        <PlaceholderPage page={currentPage} />
      )}
    </AppLayout>
  )
}
