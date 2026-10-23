import { forwardRef } from 'react'
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

      <span className="topbar__badge">Oberfläche</span>
    </header>
  )
})
