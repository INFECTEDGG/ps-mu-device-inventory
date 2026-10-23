import type { MouseEvent } from 'react'
import type { NavigationEntry } from '../../config/navigation'
import { AppIcon } from '../ui/AppIcon'

interface NavigationItemProps {
  entry: NavigationEntry
  isActive: boolean
  onNavigate: (path: string, event: MouseEvent<HTMLAnchorElement>) => void
}

export function NavigationItem({ entry, isActive, onNavigate }: NavigationItemProps) {
  return (
    <li>
      <a
        aria-current={isActive ? 'page' : undefined}
        className="navigation-item"
        data-navigation-link
        href={entry.path}
        onClick={(event) => onNavigate(entry.path, event)}
      >
        <span className="navigation-item__icon">
          <AppIcon name={entry.icon} size={20} />
        </span>
        <span>{entry.label}</span>
      </a>
    </li>
  )
}
