import type { NavigationEntry } from '../config/navigation'
import { PageContainer } from '../components/ui/PageContainer'
import { PageHeader } from '../components/ui/PageHeader'
import { PlaceholderPanel } from '../components/ui/PlaceholderPanel'

interface PlaceholderPageProps {
  page: NavigationEntry
}

export function PlaceholderPage({ page }: PlaceholderPageProps) {
  return (
    <PageContainer>
      <PageHeader
        description="Eine einheitliche Oberfläche für die zentrale Verwaltung von Unternehmensgeräten."
        title={page.label}
      />
      <PlaceholderPanel description={page.description} icon={page.icon} title={page.label} />
    </PageContainer>
  )
}
