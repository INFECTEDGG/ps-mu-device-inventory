
import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { navigationEntries } from './config/navigation'
import { hasPermission, type Role } from './config/permissions'
import { useAppNavigation } from './hooks/useAppNavigation'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export default function App() {
  const { currentPath, navigate } = useAppNavigation()

  // Die Rolle wird später aus Michas Login-System übernommen.
  // Ohne gültige Rolle werden geschützte Seiten gesperrt.
  const role: Role | null = null

  // Aktuelle Seite anhand des Pfads ermitteln
  const currentPage = navigationEntries.find(
    (entry) => entry.path === currentPath
  )

  // Prüfen, ob die Rolle die benötigte Berechtigung besitzt
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
