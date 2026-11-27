import { useEffect, useState, type MouseEvent } from 'react'
import { AppIcon } from '../../components/ui/AppIcon'
import { PageContainer } from '../../components/ui/PageContainer'
import { PageHeader } from '../../components/ui/PageHeader'
import { hasPermission } from '../../config/permissions'
import { useAuthSession } from '../../hooks/useAuthSession'
import { assignmentOverviewApi, type AssignmentOverview } from '../assignments/assignmentOverviewApi'
import { dashboardApi, type DeviceDashboardCounts } from './dashboardApi'
import './dashboard.css'

interface DashboardPageProps {
  onNavigate: (path: string, event: MouseEvent<HTMLAnchorElement>) => void
}

const numberFormat = new Intl.NumberFormat('de-DE')
const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const { session, role, permissions, userId } = useAuthSession()
  const canSeeDevices = hasPermission(role, 'devices:view_own', permissions) ||
    hasPermission(role, 'devices:view_all', permissions) || hasPermission(role, 'devices:manage', permissions)
  const canSeeAssignments = hasPermission(role, 'assignments:view_own', permissions) ||
    hasPermission(role, 'assignments:view_all', permissions)
  const canManageDevices = hasPermission(role, 'devices:manage', permissions) &&
    role !== 'employee'
  const allDevices = hasPermission(role, 'devices:view_all', permissions)

  const [counts, setCounts] = useState<DeviceDashboardCounts | null>(null)
  const [assignments, setAssignments] = useState<AssignmentOverview | null>(null)
  const [deviceError, setDeviceError] = useState('')
  const [assignmentError, setAssignmentError] = useState('')
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!session || !userId || !role) return
    let active = true
    setLoading(true)
    setDeviceError('')
    setAssignmentError('')
    setCounts(null)
    setAssignments(null)

    const jobs: Promise<void>[] = []
    if (canSeeDevices) {
      jobs.push(dashboardApi.counts(userId, allDevices).then(data => {
        if (active) setCounts(data)
      }).catch(() => {
        if (active) setDeviceError('Die Gerätekennzahlen konnten nicht geladen werden. Bitte erneut versuchen.')
      }))
    }
    if (canSeeAssignments) {
      jobs.push(assignmentOverviewApi.list('active', 0).then(data => {
        if (active) setAssignments(data)
      }).catch(() => {
        if (active) setAssignmentError('Aktuelle Zuweisungen konnten nicht geladen werden.')
      }))
    }
    void Promise.all(jobs).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session?.user.id, userId, role, canSeeDevices, canSeeAssignments, allDevices, version])

  const cards = counts ? [
    { label: allDevices ? 'Geräte im Bestand' : 'Meine sichtbaren Geräte', value: counts.total, css: 'total' },
    { label: 'Verfügbar', value: counts.available, css: 'available' },
    { label: 'Zugewiesen', value: counts.assigned, css: 'assigned' },
    { label: 'Defekt', value: counts.defective, css: 'defective' },
    { label: 'In Wartung', value: counts.maintenance, css: 'maintenance' },
    { label: 'Ausgemustert', value: counts.retired, css: 'retired' },
    { label: 'Status nicht gesetzt', value: counts.unset, css: 'unset' },
  ] : []

  return <PageContainer>
    <PageHeader title="Dashboard" description={allDevices
      ? 'Gerätebestand und laufende Zuweisungen auf einen Blick.'
      : 'Deine Geräte und Zuweisungen auf einen Blick.'} />
    <div className="dashboard-toolbar">
      <button type="button" className="dashboard-button" onClick={() => setVersion(v => v + 1)} disabled={loading}>
        {loading ? 'Wird aktualisiert …' : 'Aktualisieren'}
      </button>
    </div>

    {canSeeDevices && <section aria-labelledby="dashboard-devices-title" className="dashboard-section">
      <h2 id="dashboard-devices-title">Geräteübersicht</h2>
      {deviceError && <p role="alert" className="dashboard-error">{deviceError}</p>}
      {!deviceError && loading && !counts && <p role="status" className="dashboard-help">Gerätekennzahlen werden geladen …</p>}
      {counts && <div className="dashboard-metrics">
        {cards.map(card => <article className={`dashboard-metric dashboard-metric--${card.css}`} key={card.css}>
          <p>{card.label}</p><strong>{numberFormat.format(card.value)}</strong>
        </article>)}
      </div>}
      <div className="dashboard-section-actions">
        <a href="/geraete" className="dashboard-link dashboard-link--primary" onClick={e => onNavigate('/geraete', e)}>
          <AppIcon name="devices" size={18} /> Geräte ansehen
        </a>
        {canManageDevices && <span className="dashboard-help">Neue Geräte und Statusänderungen verwaltest du im Menü „Geräte“.</span>}
      </div>
    </section>}

    {canSeeAssignments && <section aria-labelledby="dashboard-assignments-title" className="dashboard-section">
      <div className="dashboard-section-title">
        <h2 id="dashboard-assignments-title">Aktuelle Zuweisungen</h2>
        {assignments && <span className="dashboard-count">{numberFormat.format(assignments.active_count)} aktiv</span>}
      </div>
      {assignmentError && <p role="alert" className="dashboard-error">{assignmentError}</p>}
      {!assignmentError && loading && !assignments && <p role="status" className="dashboard-help">Zuweisungen werden geladen …</p>}
      {assignments && (assignments.items.length === 0
        ? <p className="dashboard-help">Derzeit keine aktiven Zuweisungen vorhanden.</p>
        : <div className="dashboard-table-scroll"><table className="dashboard-table">
            <thead><tr><th scope="col">Gerät</th><th scope="col">Mitarbeiter</th><th scope="col">Zugewiesen am</th></tr></thead>
            <tbody>{assignments.items.slice(0, 5).map(item => <tr key={item.assignment_id}>
              <td><strong>{item.asset_tag}</strong><span>{[item.device_type, item.model].filter(Boolean).join(' · ')}</span></td>
              <td>{item.employee_name}</td>
              <td>{Number.isNaN(new Date(item.assigned_at).getTime()) ? '–' : dateFormat.format(new Date(item.assigned_at))}</td>
            </tr>)}</tbody>
          </table></div>)}
      <div className="dashboard-section-actions">
        <a href="/zuweisungen" className="dashboard-link" onClick={e => onNavigate('/zuweisungen', e)}>
          <AppIcon name="assignments" size={18}/> Zuweisungen öffnen
        </a>
      </div>
    </section>}

    {!canSeeDevices && !canSeeAssignments && <section className="dashboard-section">
      <h2>Willkommen im Device Inventory</h2>
      <p className="dashboard-help">Für deinen Account sind noch keine Geräte- oder Zuweisungsansichten freigeschaltet.</p>
    </section>}
  </PageContainer>
}
