import { useEffect, useState, type FormEvent } from 'react'
import { assignmentApi, AssignmentApiError, type AssignmentCandidate } from './assignmentApi'
import type { DeviceRecord } from './deviceApi'
import { RevealPanel } from '../../components/ui/RevealPanel'
import { isDeviceAssignable } from './deviceAssignmentRules'

interface Props {
  device: DeviceRecord
  onCancel: () => void
  onSuccess: (assetTag: string) => void
}

export function DeviceAssignmentPanel({ device, onCancel, onSuccess }: Props) {
  const [candidates, setCandidates] = useState<AssignmentCandidate[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setCandidates([])
    setEmployeeId('')
    void assignmentApi.candidates().then(rows => {
      if (!active) return
      setCandidates(rows)
    }).catch(error => {
      if (!active) return
      setError(error instanceof AssignmentApiError ? error.message : 'Mitarbeitende konnten nicht geladen werden.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [device.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || loading || !isDeviceAssignable(device.status) || !employeeId ||
      !candidates.some(candidate => candidate.user_id === employeeId)) return
    setSaving(true)
    setError('')
    try {
      await assignmentApi.assign(device.id, employeeId)
      onSuccess(device.asset_tag)
    } catch (error) {
      setError(error instanceof AssignmentApiError ? error.message : 'Die Zuweisung konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  return <RevealPanel focusKey={`assignment-${device.id}`} className="devices-panel" aria-labelledby="device-assignment-title">
    <h2 id="device-assignment-title">Gerät zuweisen – {device.asset_tag}</h2>
    <p className="devices-help">Nur verfügbare Geräte können zugewiesen werden. Die Zuweisung und der Statuswechsel werden gemeinsam in Supabase gespeichert.</p>
    <form onSubmit={(event) => void submit(event)} aria-busy={saving || loading}>
      <div className="devices-assignment-fields">
        <label htmlFor="device-assignment-person">Mitarbeiter auswählen
          <select id="device-assignment-person" required value={employeeId}
            disabled={saving || loading || candidates.length === 0}
            onChange={event => setEmployeeId(event.target.value)}>
            <option value="">Bitte auswählen</option>
            {candidates.map(candidate => <option key={candidate.user_id} value={candidate.user_id}>
              {candidate.display_name} ({candidate.email})
            </option>)}
          </select>
        </label>
      </div>
      {loading && <p role="status" className="devices-help">Mitarbeitende werden geladen …</p>}
      {!loading && !error && candidates.length === 0 && <p className="devices-help">
        Keine aktiven Mitarbeiterkonten vorhanden. Bitte zuerst einen Mitarbeiter anlegen.
      </p>}
      {error && <p role="alert" className="devices-error">{error}</p>}
      <div className="devices-actions">
        <button className="devices-button devices-button--primary" type="submit"
          disabled={saving || loading || !employeeId || !isDeviceAssignable(device.status)}>
          {saving ? 'Wird zugewiesen …' : 'Zuweisung bestätigen'}
        </button>
        <button className="devices-button" type="button" disabled={saving} onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  </RevealPanel>
}
