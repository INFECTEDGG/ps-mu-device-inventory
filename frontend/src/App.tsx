import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { navigationEntries } from './config/navigation'
import { hasPermission } from './config/permissions'
import { useAppNavigation } from './hooks/useAppNavigation'
import { useAuthSession } from './hooks/useAuthSession'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { AccountAccessPage } from './pages/AccountAccessPage'
import { PageContainer } from './components/ui/PageContainer'
import { PageHeader } from './components/ui/PageHeader'

export default function App() {
  const { session, role, isLoading, isRoleLoading, profileError, reloadProfile } = useAuthSession()
  const { currentPath, navigate } = useAppNavigation()

  const currentPage = navigationEntries.find(
    (entry) => entry.path === currentPath,
  )

  const hasAccess = currentPage ? hasPermission(role, currentPage.requiredPermission) : false
  const isChecking = isLoading || (session !== null && isRoleLoading)
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

    const frame = requestAnimationFrame(
      () => document.getElementById('page-title')?.focus(),
    )

    return () => cancelAnimationFrame(frame)
  }, [title, currentPath])

  if (isChecking) {
    return (
      <main className="login-page" aria-busy="true">
        <p role="status">{isLoading ? 'Sitzung wird geprüft …' : 'Zugriffsberechtigungen werden geprüft …'}</p>
      </main>
    )
  }

  if (!session) {
    return <LoginPage />
  }

  if (profileError) {
    return <AccountAccessPage message={profileError} onRetry={reloadProfile} />
  }

  if (currentPath === '/login') return <LoginPage />

  return (
    <AppLayout
      currentPage={currentPage?.label ?? 'Nicht gefunden'}
      currentPath={currentPath}
      onNavigate={navigate}
      role={role}
    >
      {currentPage && !hasAccess ? (
        <PageContainer>
          <PageHeader title="Zugriff verweigert" description="Du hast keine Berechtigung, diese Seite aufzurufen." />
        </PageContainer>
      ) : currentPage ? (
        <PlaceholderPage page={currentPage} />
      ) : (
        <NotFoundPage onNavigate={navigate} />
      )}
    </AppLayout>
  )
}
