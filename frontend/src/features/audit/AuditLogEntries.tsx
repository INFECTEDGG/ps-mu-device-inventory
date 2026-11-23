import type { AuditLogEntry } from './auditLogApi'
import {
  auditActionLabel,
  auditActorLabel,
  auditEntityLabel,
  auditEntityTitle,
  describeAuditDetails,
  formatAuditTimestamp,
} from './auditLogFormat'
import './audit.css'

interface AuditLogEntriesProps {
  entries: readonly AuditLogEntry[]
  /** Zugänglicher Name der scrollbaren Tabelle (Standard: „Audit-Einträge“). */
  label?: string
  /** Blendet die Spalte „Objekt“ aus (Ansicht innerhalb der Gerätedetails). */
  compact?: boolean
}

function validDateTime(iso: string): string | undefined {
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso
}

/** Wiederverwendbare Tabelle der Audit-Einträge (globales Audit-Log und Gerätedetails). */
export function AuditLogEntries({ entries, label = 'Audit-Einträge', compact = false }: AuditLogEntriesProps) {
  return (
    <div className="audit-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className={`audit-table${compact ? ' audit-table--compact' : ''}`}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">Zeitpunkt</th>
            <th scope="col">Benutzer</th>
            <th scope="col">Aktion</th>
            {!compact && <th scope="col">Objekt</th>}
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => {
            const actor = auditActorLabel(entry)
            const email = entry.user_email?.trim() ?? ''
            const isSystem = !entry.user_name?.trim() && email === ''
            const details = describeAuditDetails(entry)
            return (
              <tr key={entry.id}>
                <td className="audit-cell-time">
                  <time dateTime={validDateTime(entry.created_at)}>{formatAuditTimestamp(entry.created_at)}</time>
                </td>
                <td>
                  {isSystem
                    ? <span className="audit-system">{actor}</span>
                    : <>
                      <span>{actor}</span>
                      {email !== '' && email !== actor && <span className="audit-muted">{email}</span>}
                    </>}
                </td>
                <td><span className="audit-action">{auditActionLabel(entry.action)}</span></td>
                {!compact && <td>
                  <span className="audit-muted audit-muted--label">{auditEntityLabel(entry.entity_type)}</span>
                  <strong>{auditEntityTitle(entry)}</strong>
                </td>}
                <td>
                  {details.length === 0
                    ? <span className="audit-muted">
                      <span aria-hidden="true">–</span><span className="sr-only">Keine Details</span>
                    </span>
                    : <ul className="audit-details">
                      {details.map((detail, index) => <li key={index}>{detail}</li>)}
                    </ul>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
