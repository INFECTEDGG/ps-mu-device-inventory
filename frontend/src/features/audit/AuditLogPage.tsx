import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PageContainer } from '../../components/ui/PageContainer'
import { PageHeader } from '../../components/ui/PageHeader'
import { useAuthSession } from '../../hooks/useAuthSession'
import { mayViewAuditLog } from './auditAccess'
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_PAGE_SIZE,
  AUDIT_SEARCH_MAX_LENGTH,
  AuditLogError,
  auditLogApi,
  buildAuditRpcArgs,
  EMPTY_AUDIT_FILTERS,
  type AuditLogFilters,
  type AuditLogPage as AuditLogResult,
} from './auditLogApi'
import { AUDIT_ACTION_GROUPS, auditActionLabels, auditEntityLabels } from './auditLogFormat'
import { AuditLogEntries } from './AuditLogEntries'
import './audit.css'

const EMPTY_RESULT: AuditLogResult = { total: 0, page_size: AUDIT_PAGE_SIZE, items: [] }

type FilterField = keyof AuditLogFilters
interface FormError {
  message: string
  field?: FilterField
}

const fieldIds: Record<FilterField, string> = {
  action: 'audit-filter-action',
  entityType: 'audit-filter-entity',
  search: 'audit-filter-search',
  from: 'audit-filter-from',
  to: 'audit-filter-to',
}

function countLabel(total: number): string {
  return total === 1 ? '1 Eintrag gefunden.' : `${new Intl.NumberFormat('de-DE').format(total)} Einträge gefunden.`
}

/** Audit-Log für Administratoren und SuperAdmins (PBI-15, FA-20/FA-21). */
export function AuditLogPage() {
  const { session, userId, role, permissions, isLoading, isRoleLoading } = useAuthSession()
  const allowed = Boolean(session && userId && !isLoading && !isRoleLoading) && mayViewAuditLog(role, permissions)

  const [draft, setDraft] = useState<AuditLogFilters>({ ...EMPTY_AUDIT_FILTERS })
  const [applied, setApplied] = useState<AuditLogFilters>({ ...EMPTY_AUDIT_FILTERS })
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<AuditLogResult>(EMPTY_RESULT)
  const [hasResult, setHasResult] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState<FormError | null>(null)
  const fromInput = useRef<HTMLInputElement>(null)
  const toInput = useRef<HTMLInputElement>(null)
  const resultsHeading = useRef<HTMLHeadingElement>(null)
  const focusResultsAfterLoad = useRef(false)

  useEffect(() => {
    if (!allowed) return
    let active = true
    setLoading(true)
    setError('')
    auditLogApi.list(applied, page).then(data => {
      if (!active) return
      const lastPage = Math.max(0, Math.ceil(data.total / data.page_size) - 1)
      // Seit dem letzten Abruf sind Einträge weggefallen: auf die letzte vorhandene Seite wechseln.
      if (data.items.length === 0 && page > lastPage) {
        setPage(lastPage)
        return
      }
      setResult(data)
      setHasResult(true)
      setLoading(false)
      if (focusResultsAfterLoad.current) {
        focusResultsAfterLoad.current = false
        resultsHeading.current?.focus()
      }
    }).catch((err: unknown) => {
      if (!active) return
      focusResultsAfterLoad.current = false
      setResult(EMPTY_RESULT)
      setHasResult(false)
      setError(err instanceof AuditLogError ? err.message : 'Das Audit-Log konnte nicht geladen werden.')
      setLoading(false)
    })
    return () => { active = false }
  }, [allowed, userId, applied, page, reload])

  // Fokus erst nach dem Rendern setzen, damit das Feld bereits als ungültig markiert und mit der Meldung verknüpft ist.
  useEffect(() => {
    if (formError?.field) document.getElementById(fieldIds[formError.field])?.focus()
  }, [formError])

  if (!allowed) {
    return <PageContainer>
      <PageHeader title="Zugriff verweigert" description="Du hast keine Berechtigung, das Audit-Log anzusehen." />
    </PageContainer>
  }

  function update<K extends FilterField>(key: K, value: AuditLogFilters[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Unvollständige Datumseingaben liefert der Browser als leeren Wert – nicht stillschweigend ignorieren.
    if (fromInput.current?.validity?.badInput) {
      setFormError({ message: 'Bitte ein vollständiges Datum im Feld „Von“ angeben.', field: 'from' })
      return
    }
    if (toInput.current?.validity?.badInput) {
      setFormError({ message: 'Bitte ein vollständiges Datum im Feld „Bis“ angeben.', field: 'to' })
      return
    }
    const next: AuditLogFilters = { ...draft, search: draft.search.trim() }
    try {
      buildAuditRpcArgs(next, 0)
    } catch (err) {
      setFormError(err instanceof AuditLogError
        ? { message: err.message, field: err.field }
        : { message: 'Ungültige Filterauswahl.' })
      return
    }
    setFormError(null)
    setDraft(next)
    setApplied(next)
    setPage(0)
  }

  function reset() {
    // Auch unvollständige Datumseingaben im Browser leeren.
    for (const input of [fromInput.current, toInput.current]) if (input) input.value = ''
    setFormError(null)
    setDraft({ ...EMPTY_AUDIT_FILTERS })
    setApplied({ ...EMPTY_AUDIT_FILTERS })
    setPage(0)
  }

  function goToPage(next: number) {
    focusResultsAfterLoad.current = true
    setPage(next)
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.page_size))
  const invalid = (field: FilterField) => formError?.field === field || undefined
  const describedBy = (field: FilterField, hint?: string) =>
    [hint, formError?.field === field ? 'audit-filter-error' : undefined].filter(Boolean).join(' ') || undefined
  const statusText = loading
    ? 'Audit-Einträge werden geladen …'
    : error
      ? ''
      : result.total === 0
        ? 'Keine Audit-Einträge für die gewählten Filter gefunden.'
        : countLabel(result.total)

  return <PageContainer>
    <PageHeader title="Audit-Log" description="Nachvollziehen, wer wann welche Änderung im System vorgenommen hat." />

    <section className="audit-panel" aria-labelledby="audit-filter-title">
      <h2 id="audit-filter-title">Filter</h2>
      <form className="audit-filter-form" onSubmit={submit} noValidate aria-label="Audit-Log filtern">
        <div className="audit-filter-grid">
          <div className="audit-filter-field">
            <label htmlFor={fieldIds.action}>Aktion</label>
            <select id={fieldIds.action} className="audit-field" value={draft.action}
              aria-invalid={invalid('action')} aria-describedby={describedBy('action')}
              onChange={event => update('action', event.target.value as AuditLogFilters['action'])}>
              <option value="">Alle Aktionen</option>
              {AUDIT_ACTION_GROUPS.map(group => <optgroup key={group.label} label={group.label}>
                {group.actions.map(action => <option key={action} value={action}>{auditActionLabels[action]}</option>)}
              </optgroup>)}
            </select>
          </div>
          <div className="audit-filter-field">
            <label htmlFor={fieldIds.entityType}>Objekttyp</label>
            <select id={fieldIds.entityType} className="audit-field" value={draft.entityType}
              aria-invalid={invalid('entityType')} aria-describedby={describedBy('entityType')}
              onChange={event => update('entityType', event.target.value as AuditLogFilters['entityType'])}>
              <option value="">Alle Objekttypen</option>
              {AUDIT_ENTITY_TYPES.map(type => <option key={type} value={type}>{auditEntityLabels[type]}</option>)}
            </select>
          </div>
          <div className="audit-filter-field">
            <label htmlFor={fieldIds.search}>Suche</label>
            <input id={fieldIds.search} className="audit-field" type="search" maxLength={AUDIT_SEARCH_MAX_LENGTH}
              placeholder="z. B. Geräte-ID, Name oder E-Mail" value={draft.search}
              aria-invalid={invalid('search')} aria-describedby={describedBy('search', 'audit-filter-search-hint')}
              onChange={event => update('search', event.target.value)} />
            <span id="audit-filter-search-hint" className="audit-hint">
              Durchsucht Objekt, ausführenden Benutzer, Mitarbeiter und Rolle.
            </span>
          </div>
          <fieldset className="audit-period">
            <legend>Zeitraum</legend>
            <div className="audit-period__fields">
              <div className="audit-filter-field">
                <label htmlFor={fieldIds.from}>Von</label>
                <input id={fieldIds.from} ref={fromInput} className="audit-field" type="date"
                  value={draft.from} max={draft.to || undefined}
                  aria-invalid={invalid('from')} aria-describedby={describedBy('from')}
                  onChange={event => update('from', event.target.value)} />
              </div>
              <div className="audit-filter-field">
                <label htmlFor={fieldIds.to}>Bis</label>
                <input id={fieldIds.to} ref={toInput} className="audit-field" type="date"
                  value={draft.to} min={draft.from || undefined}
                  aria-invalid={invalid('to')} aria-describedby={describedBy('to')}
                  onChange={event => update('to', event.target.value)} />
              </div>
            </div>
          </fieldset>
        </div>
        {formError && <p id="audit-filter-error" role="alert" className="audit-error audit-error--inline">
          {formError.message}
        </p>}
        <div className="audit-filter-actions">
          <button type="submit" className="audit-button audit-button--primary">Filter anwenden</button>
          <button type="button" className="audit-button" onClick={reset}>Zurücksetzen</button>
        </div>
      </form>
    </section>

    <section className={`audit-panel${loading && hasResult ? ' audit-panel--busy' : ''}`}
      aria-labelledby="audit-results-title" aria-busy={loading}>
      <div className="audit-results-header">
        <h2 id="audit-results-title" ref={resultsHeading} tabIndex={-1}>Einträge</h2>
        <p className="audit-results-status" role="status" aria-live="polite">{statusText}</p>
      </div>
      {error
        ? <div role="alert" className="audit-error">
          <p>{error}</p>
          <button type="button" className="audit-button" onClick={() => setReload(value => value + 1)}>
            Erneut versuchen
          </button>
        </div>
        : hasResult && result.items.length > 0 && <AuditLogEntries entries={result.items} label="Audit-Einträge" />}
      {!error && hasResult && result.total > result.page_size &&
        <nav className="audit-pagination" aria-label="Seitenauswahl">
          <button type="button" className="audit-button" disabled={page === 0}
            onClick={() => goToPage(Math.max(0, page - 1))}>Zurück</button>
          <span>Seite {Math.min(page + 1, totalPages)} von {totalPages}</span>
          <button type="button" className="audit-button" disabled={page + 1 >= totalPages}
            onClick={() => goToPage(page + 1)}>Weiter</button>
        </nav>}
    </section>
  </PageContainer>
}
