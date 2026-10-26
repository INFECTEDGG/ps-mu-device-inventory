import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import type { Role } from '../../config/permissions'

interface AppLayoutProps {
  children: ReactNode
  currentPage: string
  currentPath: string
  onNavigate: (path: string, event: MouseEvent<HTMLAnchorElement>) => void
  role: Role | null
}

const desktopNavigationQuery = '(min-width: 64.0625rem)'

export function AppLayout({ children, currentPage, currentPath, onNavigate, role }: AppLayoutProps) {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(desktopNavigationQuery).matches)
  const navigationRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const closeNavigation = useCallback(() => {
    setIsNavigationOpen(false)
    requestAnimationFrame(() => menuButtonRef.current?.focus())
  }, [])

  const handleNavigate = useCallback(
    (path: string, event: MouseEvent<HTMLAnchorElement>) => {
      setIsNavigationOpen(false)
      onNavigate(path, event)
    },
    [onNavigate],
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia(desktopNavigationQuery)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches)
      if (event.matches) setIsNavigationOpen(false)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (!isNavigationOpen || isDesktop) return

    const navigation = navigationRef.current
    const focusableElements = navigation?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    )
    const firstElement = focusableElements?.item(0)
    const lastElement = focusableElements?.item((focusableElements?.length ?? 1) - 1)

    document.body.classList.add('navigation-is-open')
    firstElement?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeNavigation()
        return
      }

      if (event.key !== 'Tab' || !firstElement || !lastElement) return

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.classList.remove('navigation-is-open')
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeNavigation, isDesktop, isNavigationOpen])

  const navigationIsInteractive = isDesktop || isNavigationOpen

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Zum Hauptinhalt springen</a>

      <Sidebar
        role={role}
        currentPath={currentPath}
        isInteractive={navigationIsInteractive}
        isOpen={isNavigationOpen}
        onClose={closeNavigation}
        onNavigate={handleNavigate}
        ref={navigationRef}
      />

      {isNavigationOpen && !isDesktop ? (
        <button
          aria-label="Navigation schließen"
          className="navigation-backdrop"
          onClick={closeNavigation}
          tabIndex={-1}
          type="button"
        />
      ) : null}

      <div className="app-shell__workspace" inert={isNavigationOpen && !isDesktop}>
        <Header
          currentPage={currentPage}
          isNavigationOpen={isNavigationOpen}
          onOpenNavigation={() => setIsNavigationOpen(true)}
          ref={menuButtonRef}
        />
        <main className="main-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}
