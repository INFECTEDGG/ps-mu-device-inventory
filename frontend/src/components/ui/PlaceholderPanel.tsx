import { AppIcon, type IconName } from './AppIcon'

interface PlaceholderPanelProps {
  description: string
  icon: IconName
  title: string
}

export function PlaceholderPanel({ description, icon, title }: PlaceholderPanelProps) {
  return (
    <section aria-labelledby="placeholder-title" className="placeholder-panel">
      <div className="placeholder-panel__icon">
        <AppIcon name={icon} size={28} />
      </div>
      <span className="placeholder-panel__label">Platzhalter</span>
      <h2 id="placeholder-title">{title} ist vorbereitet</h2>
      <p>{description}</p>
    </section>
  )
}
