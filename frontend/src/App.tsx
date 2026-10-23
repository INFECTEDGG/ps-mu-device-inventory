import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { navigationEntries } from './config/navigation'
import { useAppNavigation } from './hooks/useAppNavigation'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export default function App() {
  const { currentPath, navigate } = useAppNavigation()
  const currentPage = navigationEntries.find((entry) => entry.path === currentPath)

  useEffect(() => {
    document.title = `${currentPage?.label ?? 'Seite nicht gefunden'} | Device Inventory`
    requestAnimationFrame(() => document.getElementById('page-title')?.focus())
  }, [currentPage])

  return (
    <AppLayout
      currentPage={currentPage?.label ?? 'Nicht gefunden'}
      currentPath={currentPath}
      onNavigate={navigate}
    >
      {currentPage ? (
        <PlaceholderPage page={currentPage} />
      ) : (
        <NotFoundPage onNavigate={navigate} />
      )}
    </AppLayout>
  )
}
