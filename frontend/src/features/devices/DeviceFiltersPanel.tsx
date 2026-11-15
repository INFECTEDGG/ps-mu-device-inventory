import { type FormEvent } from 'react'
import { type DeviceAssignee, type DeviceFilters, hasActiveDeviceFilters } from './deviceFilters'

interface DeviceFiltersPanelProps {
  value: DeviceFilters
  onChange: (next: DeviceFilters) => void
  onSearch: () => void
  onReset: () => void
  assignees: DeviceAssignee[]
  assigneeError: string
  showEmployeeFilter: boolean
  disabled: boolean
  hasAppliedFilters: boolean
}

export function DeviceFiltersPanel({
  value, onChange, onSearch, onReset, assignees, assigneeError,
  showEmployeeFilter, disabled, hasAppliedFilters,
}: DeviceFiltersPanelProps) {
  function update<K extends keyof DeviceFilters>(key: K, next: DeviceFilters[K]) {
    onChange({ ...value, [key]: next })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSearch()
  }
  return (
    <form className="devices-filter-form" onSubmit={submit} aria-label="Geräte suchen und filtern">
      <div className="devices-filter-fields">
        <label htmlFor="devices-search">Freitextsuche
          <input id="devices-search" type="search" maxLength={100} disabled={disabled}
            placeholder="Geräte-ID, Seriennummer, Hersteller, Modell …"
            value={value.search} onChange={(event) => update('search', event.target.value)} />
        </label>
        <label htmlFor="devices-type-filter">Gerätetyp
          <input id="devices-type-filter" maxLength={100} disabled={disabled}
            placeholder="z. B. Laptop oder Smartphone"
            value={value.deviceType} onChange={(event) => update('deviceType', event.target.value)} />
        </label>
        <label htmlFor="devices-status-filter">Gerätestatus
          <select id="devices-status-filter" disabled={disabled} value={value.status}
            onChange={(event) => update('status', event.target.value as DeviceFilters['status'])}>
            <option value="all">Alle Status</option>
            <option value="available">Verfügbar</option>
            <option value="assigned">Zugewiesen</option>
            <option value="defective">Defekt</option>
            <option value="maintenance">Wartung</option>
            <option value="retired">Ausgemustert</option>
            <option value="unset">Nicht gesetzt</option>
          </select>
        </label>
        {showEmployeeFilter && <label htmlFor="devices-employee-filter">Zugewiesener Mitarbeiter
          <select id="devices-employee-filter" disabled={disabled || Boolean(assigneeError)}
            value={value.employeeId}
            onChange={(event) => update('employeeId', event.target.value)}>
            <option value="">Alle Mitarbeitenden</option>
            {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>
              {assignee.label}
            </option>)}
          </select>
        </label>}
      </div>
      {showEmployeeFilter && assigneeError && <p className="devices-filter-hint" role="status">
        {assigneeError}
      </p>}
      <div className="devices-filter-actions">
        <button type="submit" className="devices-button devices-button--primary" disabled={disabled}>
          Suchen / Filtern
        </button>
        <button type="button" className="devices-button" disabled={disabled || !(hasActiveDeviceFilters(value) || hasAppliedFilters)}
          onClick={onReset}>Zurücksetzen</button>
      </div>
    </form>
  )
}
