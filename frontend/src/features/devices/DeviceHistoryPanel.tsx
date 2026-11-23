import { useEffect, useId, useRef, useState } from 'react'
import { useAuthSession } from '../../hooks/useAuthSession'
import { AuditLogEntries } from '../audit/AuditLogEntries'
import {
  AUDIT_MAX_PAGE,
  AUDIT_PAGE_SIZE,
  AuditLogError,
  EMPTY_AUDIT_FILTERS,
  auditLogApi,
  type AuditLogEntry,
} from '../audit/auditLogApi'
import { formatAuditTimestamp } from '../audit/auditLogFormat'
import {
  DeviceHistoryError,
  deviceHistoryApi,
  type DeviceHistory,
  type DeviceHistoryAssignment,
  type DeviceStatusChange,
} from './deviceHistoryApi'
import {
  assignmentDurationLabel,
  countLabel,
  formatHistoryCount,
  historyActorLabel,
  historyCapHint,
  mayViewDeviceAudit,
  mayViewDeviceHistory,
} from './deviceHistoryRules'
import { deviceStatusLabel } from './deviceStatusLabels'
import './devices.css'
import './devices-history.css'

/**
 * Geräte- und Zuweisungshistorie (PBI-12, FA-14) in den Gerätedetails.
 * Zeigt vergangene und aktive Zuweisungen (Mitarbeiter, Beginn, Ende), den Statusverlauf
 * und – nur für Administratoren/SuperAdmins mit `audit:view` – das Änderungsprotokoll.
 * Antworten zu einem zuvor gewählten Gerät werden verworfen.
 */
interface DeviceHistoryPanelProps {
  /** ID des in den Details geöffneten Gerätes. */
  deviceId: string
  /** Wird von der Seite nach Statuswechsel, Zuweisung oder Neuladen der Liste erhöht. */
  refreshKey?: number
}

type HistoryState =
  | { deviceId: string; status: 'loading'; data: DeviceHistory | null }
  | { deviceId: string; status: 'ready'; data: DeviceHistory }
  | { deviceId: string; status: 'error'; message: string }

const EMPTY_VALUE = '–'

function Timestamp({ value }: { value: string | null }) {
  const label = value === null ? EMPTY_VALUE : formatAuditTimestamp(value)
  return label === EMPTY_VALUE ? <>{EMPTY_VALUE}</> : <time dateTime={value ?? undefined}>{label}</time>
}

function Actor({ name }: { name: string | null }) {
  const label = historyActorLabel(name)
  return name?.trim() ? <>{label}</> : <span className="device-history-system">{label}</span>
}

function AssignmentHistory({ assignments, total }: {
  assignments: readonly DeviceHistoryAssignment[]
  total: number
}) {
  const headingId = useId()
  if (total === 0 || assignments.length === 0) {
    return <div className="device-history-section">
      <h4 id={headingId}>Zuweisungshistorie</h4>
      <p className="device-history-empty">{total === 0
        ? 'Dieses Gerät wurde noch nie zugewiesen.'
        : historyCapHint(0, total, 'Zuweisungen')}</p>
    </div>
  }
  const now = new Date()
  const activeCount = assignments.filter(assignment => assignment.active).length
  const capHint = historyCapHint(assignments.length, total, 'Zuweisungen')
  return <div className="device-history-section">
    <h4 id={headingId}>Zuweisungshistorie</h4>
    <p className="device-history-summary">
      Insgesamt {countLabel(total, 'Zuweisung', 'Zuweisungen')}, davon {activeCount === 0
        ? 'keine'
        : formatHistoryCount(activeCount)} aktiv.
    </p>
    {capHint && <p className="device-history-hint">{capHint}</p>}
    <div className="device-history-table-scroll" role="region" aria-labelledby={headingId} tabIndex={0}>
      <table className="device-history-table">
        <caption className="sr-only">Zuweisungen dieses Gerätes, neueste zuerst</caption>
        <thead>
          <tr>
            <th scope="col">Mitarbeiter</th>
            <th scope="col">Beginn</th>
            <th scope="col">Ende</th>
            <th scope="col">Dauer</th>
            <th scope="col">Ausgegeben von</th>
            <th scope="col">Zurückgenommen von</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map(assignment => {
            const name = assignment.employee_name.trim() || 'Unbekannt'
            const email = assignment.employee_email.trim()
            return <tr key={assignment.assignment_id}
              className={assignment.active ? 'device-history-row--active' : undefined}>
              <th scope="row">
                {name}
                {email !== '' && email !== name && <span className="device-history-muted">{email}</span>}
              </th>
              <td className="device-history-cell-time"><Timestamp value={assignment.assigned_at} /></td>
              <td className="device-history-cell-time">{assignment.active
                ? <span className="device-history-pill">Aktiv</span>
                : <Timestamp value={assignment.returned_at} />}</td>
              <td className="device-history-cell-time">
                {assignmentDurationLabel(assignment.assigned_at, assignment.returned_at, now)}
              </td>
              <td><Actor name={assignment.assigned_by_name} /></td>
              <td>{assignment.active
                ? <><span aria-hidden="true">{EMPTY_VALUE}</span><span className="sr-only">Noch nicht zurückgenommen</span></>
                : <Actor name={assignment.returned_by_name} />}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  </div>
}

function StatusHistory({ changes, total }: { changes: readonly DeviceStatusChange[]; total: number }) {
  const headingId = useId()
  if (total === 0 || changes.length === 0) {
    return <div className="device-history-section">
      <h4 id={headingId}>Statusverlauf</h4>
      <p className="device-history-empty">{total === 0
        ? 'Noch keine Statusänderungen protokolliert.'
        : historyCapHint(0, total, 'Statusänderungen')}</p>
    </div>
  }
  const capHint = historyCapHint(changes.length, total, 'Statusänderungen')
  return <div className="device-history-section">
    <h4 id={headingId}>Statusverlauf</h4>
    <p className="device-history-summary">
      {countLabel(total, 'Statusänderung', 'Statusänderungen')} protokolliert{total > 1 ? ', neueste zuerst' : ''}.
    </p>
    {capHint && <p className="device-history-hint">{capHint}</p>}
    <ol className="device-history-timeline" aria-labelledby={headingId}>
      {changes.map(change => <li key={change.id}>
        <span className="device-history-time"><Timestamp value={change.changed_at} /></span>
        <div className="device-history-entry">
          <p className="device-history-change">
            <span className="sr-only">Status von </span>
            <span className="device-history-badge device-history-badge--old">{deviceStatusLabel(change.old_status)}</span>
            <span className="device-history-arrow" aria-hidden="true">→</span>
            <span className="sr-only"> auf </span>
            <span className="device-history-badge">{deviceStatusLabel(change.new_status)}</span>
          </p>
          <p className="device-history-actor">Geändert von: <Actor name={change.changed_by_name} /></p>
        </div>
      </li>)}
    </ol>
  </div>
}

interface AuditTrailState {
  deviceId: string
  status: 'loading' | 'ready' | 'error'
  entries: AuditLogEntry[]
  total: number
  page: number
  pageSize: number
  error: string
  loadingMore: boolean
  moreError: string
  announcement: string
}

function initialAuditState(deviceId: string): AuditTrailState {
  return {
    deviceId,
    status: 'loading',
    entries: [],
    total: 0,
    page: 0,
    pageSize: AUDIT_PAGE_SIZE,
    error: '',
    loadingMore: false,
    moreError: '',
    announcement: '',
  }
}

/** Neue Einträge können die Seiten verschieben; bereits angezeigte Einträge nicht doppelt zeigen. */
function mergeEntries(current: readonly AuditLogEntry[], next: readonly AuditLogEntry[]): AuditLogEntry[] {
  const seen = new Set(current.map(entry => entry.id))
  return [...current, ...next.filter(entry => !seen.has(entry.id))]
}

function auditErrorMessage(error: unknown): string {
  return error instanceof AuditLogError ? error.message : 'Das Änderungsprotokoll konnte nicht geladen werden.'
}

function DeviceAuditTrail({ deviceId, refreshKey }: { deviceId: string; refreshKey: number }) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Jeder Abruf erhält eine Nummer; Antworten älterer Abrufe werden ignoriert.
  const request = useRef(0)
  const focusHeadingAfterRender = useRef(false)
  const [state, setState] = useState<AuditTrailState>(() => initialAuditState(deviceId))
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const token = ++request.current
    setState(current => current.deviceId === deviceId
      ? { ...current, status: 'loading', error: '', loadingMore: false, moreError: '', announcement: '' }
      : initialAuditState(deviceId))
    auditLogApi.list(EMPTY_AUDIT_FILTERS, 0, { type: 'device', id: deviceId }).then(page => {
      if (token !== request.current) return
      setState({
        ...initialAuditState(deviceId),
        status: 'ready',
        entries: page.items,
        total: page.total,
        pageSize: page.page_size,
      })
    }).catch((error: unknown) => {
      if (token !== request.current) return
      setState({ ...initialAuditState(deviceId), status: 'error', error: auditErrorMessage(error) })
    })
    return () => { request.current += 1 }
  }, [deviceId, refreshKey, reload])

  useEffect(() => {
    if (!focusHeadingAfterRender.current) return
    focusHeadingAfterRender.current = false
    headingRef.current?.focus()
  }, [state])

  const view = state.deviceId === deviceId ? state : initialAuditState(deviceId)
  const nextPage = view.page + 1
  const hasMore = view.status === 'ready' && nextPage * view.pageSize < view.total && nextPage <= AUDIT_MAX_PAGE

  function retry() {
    focusHeadingAfterRender.current = true
    setReload(value => value + 1)
  }

  function loadMore() {
    if (!hasMore || view.loadingMore) return
    const token = ++request.current
    const pageToLoad = nextPage
    setState(current => ({ ...current, loadingMore: true, moreError: '', announcement: '' }))
    auditLogApi.list(EMPTY_AUDIT_FILTERS, pageToLoad, { type: 'device', id: deviceId }).then(page => {
      if (token !== request.current) return
      // Ohne weitere Seiten verschwindet die Schaltfläche: Fokus dann auf die Überschrift setzen.
      focusHeadingAfterRender.current = (pageToLoad + 1) * page.page_size >= page.total
      setState(current => {
        const entries = mergeEntries(current.entries, page.items)
        const added = entries.length - current.entries.length
        return {
          ...current,
          entries,
          total: page.total,
          page: pageToLoad,
          pageSize: page.page_size,
          loadingMore: false,
          announcement: `${countLabel(added, 'weiterer Eintrag', 'weitere Einträge')} geladen.`,
        }
      })
    }).catch((error: unknown) => {
      if (token !== request.current) return
      setState(current => ({ ...current, loadingMore: false, moreError: auditErrorMessage(error) }))
    })
  }

  const statusText = view.status === 'loading'
    ? (view.entries.length > 0 ? 'Änderungsprotokoll wird aktualisiert …' : 'Änderungsprotokoll wird geladen …')
    : view.loadingMore ? 'Weitere Einträge werden geladen …' : view.announcement

  return <div className="device-history-section" aria-busy={view.status === 'loading' || view.loadingMore}>
    <h4 id={headingId} ref={headingRef} tabIndex={-1}>Änderungsprotokoll</h4>
    <p className="device-history-summary">
      Protokollierte Änderungen an Stammdaten, Status und Zuweisungen dieses Gerätes.
    </p>
    <p className="device-history-live" role="status" aria-live="polite">{statusText}</p>
    {view.status === 'error'
      ? <div role="alert" className="device-history-error">
        <p>{view.error}</p>
        <button type="button" className="devices-button" onClick={retry}>Erneut versuchen</button>
      </div>
      : view.status === 'ready' && view.entries.length === 0
        ? <p className="device-history-empty">Keine Audit-Einträge für dieses Gerät.</p>
        : view.entries.length > 0 &&
          <div className={view.status === 'loading' ? 'device-history-busy' : undefined}>
            <AuditLogEntries entries={view.entries} compact label="Einträge im Änderungsprotokoll" />
          </div>}
    {view.status === 'ready' && view.entries.length > 0 && view.total > view.entries.length &&
      <p className="device-history-hint">
        {formatHistoryCount(view.entries.length)} von {formatHistoryCount(view.total)} Einträgen angezeigt.
      </p>}
    {view.moreError && <p role="alert" className="device-history-error">{view.moreError}</p>}
    {hasMore && <button type="button" className="devices-button device-history-more"
      aria-disabled={view.loadingMore || undefined} onClick={loadMore}>
      {view.loadingMore ? 'Weitere Einträge werden geladen …' : 'Weitere Einträge laden'}
    </button>}
  </div>
}

export function DeviceHistoryPanel({ deviceId, refreshKey = 0 }: DeviceHistoryPanelProps) {
  const { session, userId, role, permissions, isLoading, isRoleLoading } = useAuthSession()
  const ready = Boolean(session && userId && !isLoading && !isRoleLoading)
  const allowed = ready && mayViewDeviceHistory(role, permissions)
  const auditAllowed = allowed && mayViewDeviceAudit(role, permissions)
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusHeadingAfterRender = useRef(false)
  const [state, setState] = useState<HistoryState>({ deviceId, status: 'loading', data: null })
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!allowed) return
    let active = true
    setState(current => ({
      deviceId,
      status: 'loading',
      // Beim Aktualisieren desselben Gerätes bleiben die bisherigen Daten bis zur Antwort sichtbar.
      data: current.deviceId === deviceId && current.status !== 'error' ? current.data : null,
    }))
    deviceHistoryApi.load(deviceId).then(data => {
      if (active) setState({ deviceId, status: 'ready', data })
    }).catch((error: unknown) => {
      if (!active) return
      setState({
        deviceId,
        status: 'error',
        message: error instanceof DeviceHistoryError
          ? error.message
          : 'Die Gerätehistorie konnte nicht geladen werden.',
      })
    })
    return () => { active = false }
  }, [allowed, userId, deviceId, refreshKey, retryCount])

  useEffect(() => {
    if (!focusHeadingAfterRender.current) return
    focusHeadingAfterRender.current = false
    headingRef.current?.focus()
  }, [state])

  if (!allowed) return null

  // Bis der neue Abruf gestartet ist, niemals Daten eines zuvor gewählten Gerätes zeigen.
  const view: HistoryState = state.deviceId === deviceId ? state : { deviceId, status: 'loading', data: null }
  const data = view.status === 'error' ? null : view.data
  const loading = view.status === 'loading'

  function retry() {
    focusHeadingAfterRender.current = true
    setRetryCount(value => value + 1)
  }

  return <section className="device-history" aria-labelledby={titleId}>
    <h3 id={titleId} ref={headingRef} tabIndex={-1}>Gerätehistorie</h3>
    <p className="device-history-summary">
      Vergangene und aktive Zuweisungen sowie Statusänderungen dieses Gerätes.
    </p>
    <div aria-busy={loading}>
      <p className="device-history-live" role="status" aria-live="polite">
        {loading ? (data ? 'Gerätehistorie wird aktualisiert …' : 'Gerätehistorie wird geladen …') : ''}
      </p>
      {view.status === 'error'
        ? <div role="alert" className="device-history-error">
          <p>{view.message}</p>
          <button type="button" className="devices-button" onClick={retry}>Erneut versuchen</button>
        </div>
        : data && <div className={loading ? 'device-history-busy' : undefined}>
          <AssignmentHistory assignments={data.assignments} total={data.assignments_total} />
          <StatusHistory changes={data.status_changes} total={data.status_changes_total} />
        </div>}
    </div>
    {auditAllowed && <DeviceAuditTrail key={userId ?? ''} deviceId={deviceId} refreshKey={refreshKey} />}
  </section>
}
