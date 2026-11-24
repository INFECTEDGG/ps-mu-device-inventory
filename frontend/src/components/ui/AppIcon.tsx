export type IconName =
  | 'assignments'
  | 'close'
  | 'dashboard'
  | 'devices'
  | 'layout'
  | 'logo'
  | 'menu'
  | 'settings'
  | 'users'

interface AppIconProps {
  name: IconName
  size?: number
}

export function AppIcon({ name, size = 24 }: AppIconProps) {
  const commonProps = {
    'aria-hidden': true,
    className: 'app-icon',
    fill: 'none',
    focusable: false,
    height: size,
    viewBox: '0 0 24 24',
    width: size,
  } as const

  switch (name) {
    case 'dashboard':
      return (
        <svg {...commonProps}>
          <path d="M4 4h6v6H4zM14 4h6v9h-6zM4 14h6v6H4zM14 17h6v3h-6z" />
        </svg>
      )
    case 'devices':
      return (
        <svg {...commonProps}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      )
    case 'assignments':
      return (
        <svg {...commonProps}>
          <path d="M8 7h11M15 3l4 4-4 4M16 17H5M9 13l-4 4 4 4" />
        </svg>
      )
    case 'users':
      return (
        <svg {...commonProps}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 5" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.4v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-1.6-1H2V10h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 4.2l.06.06A1.7 1.7 0 0 0 8 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 18.4 9a1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      )
    case 'menu':
      return (
        <svg {...commonProps}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      )
    case 'close':
      return (
        <svg {...commonProps}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      )
    case 'layout':
      return (
        <svg {...commonProps}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 9v11" />
        </svg>
      )
    case 'logo':
      return (
        <svg {...commonProps}>
          <path d="m12 3 7.5 4.2L12 11.4 4.5 7.2 12 3Z" />
          <path d="m4.5 12 7.5 4.2 7.5-4.2M4.5 16.8 12 21l7.5-4.2" />
        </svg>
      )
  }
}
