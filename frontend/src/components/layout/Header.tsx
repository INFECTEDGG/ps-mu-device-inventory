import { forwardRef, useState } from 'react'
import { logout } from '../../lib/logout'
import { AppIcon } from '../ui/AppIcon'

interface HeaderProps {
  currentPage: string
  isNavigationOpen: boolean
  onOpenNavigation: () => void
}

export const Header = forwardRef<HTMLButtonElement, HeaderProps>(function Header(
  { currentPage, isNavigationOpen, onOpenNavigation },
  ref,
) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  async function handleLogout() {
    if (isLoggingOut) return

    setIsLoggingOut(true)
    setLogoutError('')

    try {
      await logout()
    } catch {
      setLogoutError('Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.')
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <header className="topbar">
      <button
        aria-controls="primary-navigation"
        aria-expanded={isNavigationOpen}
        className="icon-button topbar__menu"
        onClick={onOpenNavigation}
        ref={ref}
        type="button"
      >
        <span className="sr-only">Navigation öffnen</span>
        <AppIcon name="menu" />
      </button>

      <div className="topbar__context">
        <span className="topbar__product">Device Inventory</span>
        <span className="topbar__separator" aria-hidden="true">/</span>
        <span className="topbar__page">{currentPage}</span>
      </div>

      <button
        aria-busy={isLoggingOut}
        className="topbar__logout"
        disabled={isLoggingOut}
        onClick={handleLogout}
        type="button"
      >
        {isLoggingOut ? 'Abmeldung läuft …' : 'Abmelden'}
      </button>

      {logoutError && <p className="topbar__logout-error" role="alert">{logoutError}</p>}
    </header>
  )
})
