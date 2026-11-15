import { useEffect, useState, type MouseEvent } from 'react'
import { PageContainer } from '../../components/ui/PageContainer'
import { PageHeader } from '../../components/ui/PageHeader'
import { ActionNotice } from '../../components/ui/ActionNotice'
import { hasPermission } from '../../config/permissions'
import { useAuthSession } from '../../hooks/useAuthSession'
import {
  assignmentOverviewApi, AssignmentOverviewError, ASSIGNMENTS_PAGE_SIZE,
  type AssignmentOverview, type AssignmentOverviewItem, type AssignmentView,
} from './assignmentOverviewApi'
import './assignments.css'

const EMPTY: AssignmentOverview = { active_count: 0, returned_count: 0, total: 0, items: [] }

function formatDate(value: string | null): string {
  if (!value) return '–'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date)
}

interface Props {
  onNavigateToDevices: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function AssignmentManagementPage({ onNavigateToDevices }: Props) {
  const { role, permissions, userId, session, isLoading, isRoleLoading } = useAuthSession()
  const ready = Boolean(session && userId && !isLoading && !isRoleLoading)
  const canRead = ready && (
    hasPermission(role, 'assignments:view_own', permissions) ||
    hasPermission(role, 'assignments:view_all', permissions)
  )
  const canReturn = ready &&
    (role === 'admin' || role === 'super_admin' || role === 'device_manager') &&
    hasPermission(role, 'assignments:manage', permissions)

  const [view, setView] = useState<AssignmentView>('active')
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [overview, setOverview] = useState<AssignmentOverview>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [returningId, setReturningId] = useState<string | null>(null)
  const [success, setSuccess] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (!canRead) return
    let mounted = true
    setLoading(true)
    setError('')
    void assignmentOverviewApi.list(view, page).then(result => {
      if (mounted) setOverview(result)
    }).catch(err => {
      if (!mounted) return
      setOverview(EMPTY)
      setError(err instanceof AssignmentOverviewError ? err.message : 'Zuweisungen konnten nicht geladen werden.')
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [canRead, userId, view, page, reload])

  function switchView(next: AssignmentView) {
    setView(next)
    setPage(0)
    setActionError('')
    setSuccess('')
  }

  async function returnDevice(item: AssignmentOverviewItem) {
    if (!canReturn || returningId) return
    const confirmed = window.confirm(
      `Gerät ${item.asset_tag} von ${item.employee_name} zurücknehmen? ` +
      'Das Gerät wird anschließend wieder als verfügbar markiert.',
    )
    if (!confirmed) return
    setReturningId(item.assignment_id)
    setActionError('')
    setSuccess('')
    try {
      await assignmentOverviewApi.returnDevice(item.assignment_id)
      setSuccess(`Gerät ${item.asset_tag} wurde zurückgenommen und ist wieder verfügbar.`)
      if (page > 0 && overview.items.length === 1) setPage(page - 1)
      else setReload(value => value + 1)
    } catch (err) {
      setActionError(err instanceof AssignmentOverviewError ? err.message : 'Gerät konnte nicht zurückgenommen werden.')
      setReload(value => value + 1)
    } finally {
      setReturningId(null)
    }
  }

  if (!canRead) {
    return <PageContainer><PageHeader title="Zugriff verweigert"
      description="Du hast keine Berechtigung, Zuweisungen anzusehen." /></PageContainer>
  }

  return <PageContainer>
    <PageHeader title="Zuweisungen" description="Ausgegebene Geräte verfolgen und zurücknehmen." />
    <section className="assignments-panel" aria-labelledby="assignments-title">
      <div className="assignments-toolbar">
        <h2 id="assignments-title">Gerätezuweisungen</h2>
        {canReturn && <a href="/geraete" className="assignments-button assignments-button--primary"
          onClick={onNavigateToDevices}>Gerät zuweisen</a>}
      </div>
      <div className="assignments-tabs" role="group" aria-label="Zuweisungsstatus">
        <button type="button" aria-pressed={view === 'active'}
          className={`assignments-button ${view === 'active' ? 'assignments-button--selected' : ''}`}
          onClick={() => switchView('active')}>Aktive Zuweisungen ({overview.active_count})</button>
        <button type="button" aria-pressed={view === 'returned'}
          className={`assignments-button ${view === 'returned' ? 'assignments-button--selected' : ''}`}
          onClick={() => switchView('returned')}>Zurückgegeben ({overview.returned_count})</button>
      </div>
      {success && <ActionNotice className="assignments-success">{success}</ActionNotice>}
      {actionError && <ActionNotice variant="error" className="assignments-error">{actionError}</ActionNotice>}
      {error ? <div role="alert" className="assignments-error">
        <p>{error}</p>
        <button type="button" className="assignments-button" onClick={() => setReload(n => n + 1)}>Erneut versuchen</button>
      </div> : loading ? <p role="status" className="assignments-help">Zuweisungen werden geladen …</p>
        : overview.items.length === 0 ? <p className="assignments-help">{view === 'active'
            ? 'Derzeit keine aktiven Gerätezuweisungen vorhanden.'
            : 'Noch keine abgeschlossenen Gerätezuweisungen vorhanden.'}</p>
        : <div className="assignments-table-scroll"><table className="assignments-table">
          <thead><tr><th scope="col">Gerät</th><th scope="col">Mitarbeiter</th>
            <th scope="col">Zugewiesen am</th><th scope="col">{view === 'active' ? 'Status' : 'Zurück am'}</th>
            {canReturn && view === 'active' && <th scope="col">Aktion</th>}
          </tr></thead>
          <tbody>{overview.items.map(item => <tr key={item.assignment_id}>
            <td><strong>{item.asset_tag}</strong><span className="assignments-muted">
              {[item.device_type, item.model].filter(Boolean).join(' · ')}</span></td>
            <td>{item.employee_name}<span className="assignments-muted">{item.employee_email}</span></td>
            <td>{formatDate(item.assigned_at)}<span className="assignments-muted">
              Ausgegeben von: {item.assigned_by_name}</span></td>
            <td>{view === 'active' ? <span className="assignments-pill">Aktiv</span> :
              <span>{formatDate(item.returned_at)}<span className="assignments-muted">
                Zurückgenommen von: {item.returned_by_name ?? '–'}</span></span>}</td>
            {canReturn && view === 'active' && <td><button type="button" className="assignments-button"
              disabled={returningId !== null} onClick={() => void returnDevice(item)}>
              {returningId === item.assignment_id ? 'Wird zurückgenommen …' : 'Zurücknehmen'}
            </button></td>}
          </tr>)}</tbody>
        </table></div>}
      {!loading && !error && overview.total > ASSIGNMENTS_PAGE_SIZE && <nav className="assignments-pagination" aria-label="Seitenauswahl">
        <button type="button" className="assignments-button" disabled={page === 0}
          onClick={() => setPage(p => Math.max(0, p - 1))}>Zurück</button>
        <span>Seite {page + 1} von {Math.ceil(overview.total / ASSIGNMENTS_PAGE_SIZE)}</span>
        <button type="button" className="assignments-button"
          disabled={(page + 1) * ASSIGNMENTS_PAGE_SIZE >= overview.total}
          onClick={() => setPage(p => p + 1)}>Weiter</button>
      </nav>}
    </section>
  </PageContainer>
}
