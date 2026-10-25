import { forwardRef, type MouseEvent } from 'react'
import { navigationEntries } from '../../config/navigation'
import { NavigationItem } from '../navigation/NavigationItem'
import { AppIcon } from '../ui/AppIcon'

interface SidebarProps {
  currentPath: string
  isInteractive: boolean
  isOpen: boolean
  onClose: () => void
  onNavigate: (path: string, event: MouseEvent<HTMLAnchorElement>) => void
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { currentPath, isInteractive, isOpen, onClose, onNavigate },
  ref,
) {
  return (
    <aside
      aria-hidden={!isInteractive}
      aria-label="Hauptnavigation"
      className={`sidebar${isOpen ? ' sidebar--open' : ''}`}
      id="primary-navigation"
      inert={!isInteractive}
      ref={ref}
    >
      <div className="sidebar__brand-row">
        <a
          aria-label="Device Inventory – zum Dashboard"
          className="brand"
          href="/"
          onClick={(event) => onNavigate('/', event)}
        >
          <span className="brand__mark">
            <AppIcon name="logo" size={25} />
          </span>
          <span className="brand__text">
            <strong>Device</strong>
            <span>Inventory</span>
          </span>
        </a>

        <button className="icon-button sidebar__close" type="button" onClick={onClose}>
          <span className="sr-only">Navigation schließen</span>
          <AppIcon name="close" />
        </button>
      </div>

      <div className="sidebar__content">
        <p className="sidebar__section-label">Arbeitsbereich</p>
        <nav aria-label="Bereiche">
          <ul className="sidebar__navigation">
            {navigationEntries.map((entry) => (
              <NavigationItem
                entry={entry}
                isActive={currentPath === entry.path}
                key={entry.path}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </nav>
      </div>

      <div className="sidebar__footer">
        <span className="sidebar__footer-mark" aria-hidden="true" />
        <div>
          <strong>UI-Grundgerüst</strong>
          <span>Bereit für Fachmodule</span>
        </div>
      </div>
    </aside>
  )
})
