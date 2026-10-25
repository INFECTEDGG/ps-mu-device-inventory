interface PageHeaderProps {
  description: string
  title: string
}

export function PageHeader({ description, title }: PageHeaderProps) {
  return (
    <header className="page-header">
      <p className="page-header__eyebrow">Arbeitsbereich</p>
      <h1 id="page-title" tabIndex={-1}>{title}</h1>
      <p className="page-header__description">{description}</p>
    </header>
  )
}
