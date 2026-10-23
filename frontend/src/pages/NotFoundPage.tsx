import type { MouseEvent } from 'react'
import { PageContainer } from '../components/ui/PageContainer'
import { PageHeader } from '../components/ui/PageHeader'
import { AppIcon } from '../components/ui/AppIcon'

interface NotFoundPageProps {
  onNavigate: (path: string, event: MouseEvent<HTMLAnchorElement>) => void
}

export function NotFoundPage({ onNavigate }: NotFoundPageProps) {
  return (
    <PageContainer>
      <PageHeader
        description="Die angeforderte Seite ist nicht Teil des vorbereiteten Anwendungsgerüsts."
        title="Seite nicht gefunden"
      />
      <section aria-labelledby="not-found-title" className="placeholder-panel">
        <div className="placeholder-panel__icon">
          <AppIcon name="layout" size={28} />
        </div>
        <span className="placeholder-panel__label">Fehler 404</span>
        <h2 id="not-found-title">Dieser Bereich ist nicht verfügbar</h2>
        <p>Über die Hauptnavigation gelangen Sie zu allen vorbereiteten Bereichen.</p>
        <a className="button-link" href="/" onClick={(event) => onNavigate('/', event)}>
          Zum Dashboard
        </a>
      </section>
    </PageContainer>
  )
}
