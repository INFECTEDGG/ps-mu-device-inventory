import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PageContainer } from '../../components/ui/PageContainer'
import { PageHeader } from '../../components/ui/PageHeader'
import { hasPermission } from '../../config/permissions'
import { useAuthSession } from '../../hooks/useAuthSession'
import {
  DEVICE_PAGE_SIZE,
  DeviceApiError,
  deviceApi,
  type DeviceRecord,
  type DeviceStatus,
  type NewDeviceInput,
} from './deviceApi'
import './devices.css'
import './devices-issue7.css'

const emptyForm: NewDeviceInput = {
  asset_tag: '', device_type: '', manufacture: '', model: '', serial_number: '',
  name: '', operating_system: '', processor: '', ram_gb: undefined,
  disk_space_gb: undefined, location: '', device_usage: '',
  purchased_at: '', start_of_use: '', maintenance_end: '',
  description: '', comments: '',
}

const deviceStatuses: Record<DeviceStatus, string> = {
  available: 'Verfügbar',
  assigned: 'Zugewiesen',
  defective: 'Defekt',
  maintenance: 'Wartung',
  retired: 'Ausgemustert',
}

function deviceToForm(device: DeviceRecord): NewDeviceInput {
  return {
    asset_tag: device.asset_tag ?? '',
    device_type: device.device_type ?? '',
    manufacture: device.manufacture ?? '',
    model: device.model ?? '',
    serial_number: device.serial_number ?? '',
    name: device.name ?? '',
    operating_system: device.operating_system ?? '',
    processor: device.processor ?? '',
    ram_gb: device.ram_gb ?? undefined,
    disk_space_gb: device.disk_space_gb ?? undefined,
    location: device.location ?? '',
    device_usage: device.device_usage ?? '',
    purchased_at: device.purchased_at ?? '',
    start_of_use: device.start_of_use ?? '',
    maintenance_end: device.maintenance_end ?? '',
    description: device.description ?? '',
    comments: device.comments ?? '',
  }
}

function statusLabel(status: string): string {
  return deviceStatuses[status as DeviceStatus] ?? status
}

function visibleValue(value: unknown): string {
  return value === undefined || value === null || value === '' ? '–' : String(value)
}

const detailFields: { label: string; field: keyof DeviceRecord }[] = [
  { label: 'Geräte-ID', field: 'asset_tag' },
  { label: 'Gerätetyp', field: 'device_type' },
  { label: 'Hersteller', field: 'manufacture' },
  { label: 'Modell', field: 'model' },
  { label: 'Seriennummer', field: 'serial_number' },
  { label: 'Name', field: 'name' },
  { label: 'Betriebssystem', field: 'operating_system' },
  { label: 'Prozessor', field: 'processor' },
  { label: 'RAM (GB)', field: 'ram_gb' },
  { label: 'Speicherplatz (GB)', field: 'disk_space_gb' },
  { label: 'Standort', field: 'location' },
  { label: 'Verwendung', field: 'device_usage' },
  { label: 'Kaufdatum', field: 'purchased_at' },
  { label: 'Nutzungsbeginn', field: 'start_of_use' },
  { label: 'Wartungsende', field: 'maintenance_end' },
  { label: 'Beschreibung', field: 'description' },
  { label: 'Kommentare', field: 'comments' },
]

export function DeviceManagementPage() {
  const { session, role, permissions, userId, isLoading, isRoleLoading } = useAuthSession()
  const canRead = Boolean(
    session && !isLoading && !isRoleLoading && (
      hasPermission(role, 'devices:view_own', permissions) ||
      hasPermission(role, 'devices:view_all', permissions) ||
      hasPermission(role, 'devices:manage', permissions)
    ),
  )
  const canManage = Boolean(session && !isLoading && !isRoleLoading &&
    hasPermission(role, 'devices:manage', permissions))
  const canViewAll = hasPermission(role, 'devices:view_all', permissions)

  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<DeviceRecord | null>(null)
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [form, setForm] = useState<NewDeviceInput>(emptyForm)
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const newButton = useRef<HTMLButtonElement>(null)
  const suggestionRequest = useRef(0)

  useEffect(() => {
    if (!canRead || !userId) return
    let active = true
    const load = async () => {
      setLoading(true)
      setListError('')
      try {
        const result = await deviceApi.list(userId, canViewAll, page)
        if (!active) return
        setDevices(result.devices)
        setTotal(result.total)
        setSelected((old) => result.devices.find((device) => device.id === old?.id) ?? null)
      } catch (error) {
        if (!active) return
        setDevices([])
        setSelected(null)
        setTotal(0)
        setListError(error instanceof DeviceApiError
          ? error.message
          : 'Geräte konnten nicht geladen werden. Bitte erneut versuchen.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [canRead, canViewAll, userId, page, refresh])

  function closeEditor() {
    suggestionRequest.current += 1
    setEditor(null)
    setForm(emptyForm)
    setFormError('')
    requestAnimationFrame(() => newButton.current?.focus())
  }

  function openCreate() {
    if (!canManage) return
    const request = ++suggestionRequest.current
    setForm(emptyForm)
    setFormError('')
    setMessage('')
    setDetailsOpen(false)
    setSelected(null)
    setEditor('create')
    void deviceApi.suggestNextAssetTag().then((tag) => {
      if (request === suggestionRequest.current) {
        setForm((value) => value.asset_tag ? value : { ...value, asset_tag: tag })
      }
    })
  }

  function openEdit(device: DeviceRecord) {
    if (!canManage) return
    suggestionRequest.current += 1
    setSelected(device)
    setForm(deviceToForm(device))
    setFormError('')
    setMessage('')
    setDetailsOpen(false)
    setEditor('edit')
  }

  function setText(field: keyof NewDeviceInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function setNumber(field: 'ram_gb' | 'disk_space_gb', value: string) {
    setForm((current) => ({ ...current, [field]: value === '' ? undefined : Number(value) }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !canManage || !userId || !editor) return
    setSaving(true)
    setFormError('')
    const editingId = selected?.id
    const mode = editor
    try {
      if (mode === 'edit') {
        if (!editingId) return
        await deviceApi.update(editingId, form)
      } else {
        await deviceApi.create(form, userId)
      }
      setMessage(mode === 'edit' ? 'Gerätedaten gespeichert.' : 'Gerät angelegt.')
      closeEditor()
      if (mode === 'create') setPage(0)
      setRefresh((value) => value + 1)
    } catch (error) {
      setFormError(error instanceof DeviceApiError
        ? error.message
        : 'Gerät konnte nicht gespeichert werden. Bitte erneut versuchen.')
    } finally {
      setSaving(false)
    }
  }

  if (!canRead) {
    return <PageContainer><PageHeader
      title="Zugriff verweigert"
      description="Du hast keine Berechtigung, Geräte anzusehen."
    /></PageContainer>
  }

  return (
    <PageContainer>
      <PageHeader title="Geräte" description="Zentraler Gerätebestand des Device Inventory." />
      <p className="devices-feedback" role="status">{message}</p>

      <section className="devices-panel" aria-labelledby="devices-title">
        <div className="devices-toolbar">
          <h2 id="devices-title">Gerätebestand <span className="devices-count">{total}</span></h2>
          {canManage && <button ref={newButton} className="devices-button devices-button--primary"
            type="button" disabled={Boolean(editor)} onClick={openCreate}>Gerät anlegen</button>}
        </div>
        {listError ? (
          <div role="alert">
            <p className="devices-error">{listError}</p>
            <button type="button" className="devices-button" onClick={() => setRefresh((v) => v + 1)}>
              Erneut versuchen
            </button>
          </div>
        ) : loading ? (
          <p className="devices-help" role="status">Geräte werden geladen …</p>
        ) : devices.length === 0 ? (
          <p className="devices-help">{page === 0
            ? (canViewAll ? 'Noch keine Geräte vorhanden.' : 'Dir sind aktuell keine Geräte zugewiesen.')
            : 'Auf dieser Seite sind keine Geräte vorhanden.'}</p>
        ) : (
          <div className="devices-table-scroll">
            <table className="devices-table">
              <thead><tr>
                <th scope="col">Geräte-ID</th>
                <th scope="col">Typ</th>
                <th scope="col">Hersteller / Modell</th>
                <th scope="col">Status</th>
                <th scope="col">Aktionen</th>
              </tr></thead>
              <tbody>{devices.map((device) => <tr key={device.id}>
                <td>{device.asset_tag}</td>
                <td>{device.device_type}</td>
                <td>{device.manufacture} {device.model}</td>
                <td><span className="devices-status">{statusLabel(device.status)}</span></td>
                <td><div className="devices-row-actions">
                  <button type="button" className="devices-button"
                    onClick={() => { setEditor(null); setSelected(device) }}>
                    Details
                  </button>
                  {canManage && <button type="button" className="devices-button"
                    onClick={() => openEdit(device)}>Bearbeiten</button>}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {!listError && !loading && total > DEVICE_PAGE_SIZE && <div className="devices-pagination">
          <button type="button" className="devices-button" disabled={page === 0}
            onClick={() => { setPage((value) => Math.max(0, value - 1)); setSelected(null); setEditor(null) }}>
            Zurück
          </button>
          <span>Seite {page + 1} von {Math.ceil(total / DEVICE_PAGE_SIZE)}</span>
          <button type="button" className="devices-button"
            disabled={(page + 1) * DEVICE_PAGE_SIZE >= total}
            onClick={() => { setPage((value) => value + 1); setSelected(null); setEditor(null) }}>
            Weiter
          </button>
        </div>}
      </section>

      {selected && !editor && <section className="devices-panel" aria-labelledby="device-details-title">
        <div className="devices-toolbar">
          <h2 id="device-details-title">Details – {selected.asset_tag}</h2>
          <button type="button" className="devices-button" onClick={() => setSelected(null)}>Schließen</button>
        </div>
        <dl className="devices-detail-grid">
          <div><dt>Status</dt><dd>{statusLabel(selected.status)}</dd></div>
          {detailFields.map(({ label, field }) => <div key={field}>
            <dt>{label}</dt><dd>{visibleValue(selected[field])}</dd>
          </div>)}
        </dl>
        {canManage && <button type="button" className="devices-button devices-button--primary"
          onClick={() => openEdit(selected)}>Gerät bearbeiten</button>}
      </section>}

      {editor && canManage && <section className="devices-panel" aria-labelledby="devices-editor-title">
        <h2 id="devices-editor-title">{editor === 'edit' ? 'Gerät bearbeiten' : 'Gerät anlegen'}</h2>
        <form onSubmit={submit} aria-busy={saving}>
          <fieldset className="devices-fields" disabled={saving}>
            <legend className="sr-only">Gerätedaten</legend>
            {([
              ['asset_tag', 'Geräte-ID'],
              ['device_type', 'Gerätetyp'],
              ['manufacture', 'Hersteller'],
              ['model', 'Modell'],
              ['serial_number', 'Seriennummer'],
            ] as const).map(([field, label]) => <label key={field}>{label}
              <input required maxLength={100} autoComplete="off" value={form[field]}
                onChange={(event) => setText(field, event.target.value)} />
            </label>)}
          </fieldset>
          <button type="button" className="devices-button devices-details-toggle"
            aria-expanded={detailsOpen} disabled={saving} onClick={() => setDetailsOpen((v) => !v)}>
            {detailsOpen ? 'Details ausblenden' : 'Details (optional)'}
          </button>
          {detailsOpen && <fieldset className="devices-fields" disabled={saving}>
            <legend className="sr-only">Weitere Angaben</legend>
            {([
              ['name', 'Name', 150], ['operating_system', 'Betriebssystem', 100],
              ['processor', 'Prozessor', 100], ['location', 'Standort', 150],
              ['device_usage', 'Verwendung', 150],
            ] as const).map(([field, label, maxLength]) => <label key={field}>{label}
              <input maxLength={maxLength} autoComplete="off" value={form[field] ?? ''}
                onChange={(event) => setText(field, event.target.value)} />
            </label>)}
            {([
              ['ram_gb', 'RAM (GB)'], ['disk_space_gb', 'Speicherplatz (GB)'],
            ] as const).map(([field, label]) => <label key={field}>{label}
              <input type="number" min={0} value={form[field] ?? ''}
                onChange={(event) => setNumber(field, event.target.value)} />
            </label>)}
            {([
              ['purchased_at', 'Kaufdatum'], ['start_of_use', 'Nutzungsbeginn'],
              ['maintenance_end', 'Wartungsende'],
            ] as const).map(([field, label]) => <label key={field}>{label}
              <input type="date" value={form[field] ?? ''}
                onChange={(event) => setText(field, event.target.value)} />
            </label>)}
            {([
              ['description', 'Beschreibung'], ['comments', 'Kommentare'],
            ] as const).map(([field, label]) => <label key={field}>{label}
              <textarea maxLength={2000} value={form[field] ?? ''}
                onChange={(event) => setText(field, event.target.value)} />
            </label>)}
          </fieldset>}
          {formError && <p className="devices-error" role="alert">{formError}</p>}
          <div className="devices-actions">
            <button className="devices-button devices-button--primary" type="submit" disabled={saving}>
              {saving ? 'Wird gespeichert …' : 'Speichern'}
            </button>
            <button type="button" className="devices-button" disabled={saving} onClick={closeEditor}>
              Abbrechen
            </button>
          </div>
        </form>
      </section>}
    </PageContainer>
  )
}
