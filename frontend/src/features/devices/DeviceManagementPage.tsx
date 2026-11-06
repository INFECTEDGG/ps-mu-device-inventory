// Neu für PBI-06 (Gerät erfassen). Ersetzt die PlaceholderPage unter /geraete.
// Die Geräteliste selbst (PBI-09) ist noch nicht Teil dieser Seite.
import { useRef, useState, type FormEvent } from 'react'
import { PageContainer } from '../../components/ui/PageContainer'
import { PageHeader } from '../../components/ui/PageHeader'
import { hasPermission } from '../../config/permissions'
import { useAuthSession } from '../../hooks/useAuthSession'
import { DeviceApiError, deviceApi, type NewDeviceInput } from './deviceApi'
import './devices.css'

const emptyForm: NewDeviceInput = {
  asset_tag: '',
  device_type: '',
  manufacture: '',
  model: '',
  serial_number: '',
  name: '',
  operating_system: '',
  processor: '',
  ram_gb: undefined,
  disk_space_gb: undefined,
  location: '',
  device_usage: '',
  purchased_at: '',
  start_of_use: '',
  maintenance_end: '',
  description: '',
  comments: '',
}

export function DeviceManagementPage() {
  const { session, role, permissions, userId, isLoading, isRoleLoading } = useAuthSession()
  const allowed =
    !!session &&
    !isLoading &&
    !isRoleLoading &&
    hasPermission(role, 'devices:manage', permissions)

  const [creating, setCreating] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [form, setForm] = useState<NewDeviceInput>(emptyForm)
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const newButton = useRef<HTMLButtonElement>(null)

  function openCreate() {
    setForm(emptyForm)
    setFormError('')
    setDetailsOpen(false)
    setCreating(true)
    // Neu für PBI-06: Vorschlag für die nächste freie Geräte-ID (IT-0001, ...).
    void deviceApi
      .suggestNextAssetTag()
      .then((suggestion) => setForm((value) => ({ ...value, asset_tag: suggestion })))
  }

  function closeCreate() {
    setCreating(false)
    setForm(emptyForm)
    setFormError('')
    requestAnimationFrame(() => newButton.current?.focus())
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !userId) return
    setSaving(true)
    setFormError('')
    try {
      await deviceApi.create(form, userId)
      setMessage('Gerät angelegt.')
      closeCreate()
    } catch (error) {
      setFormError(
        error instanceof DeviceApiError
          ? error.message
          : 'Gerät konnte nicht angelegt werden. Bitte erneut versuchen.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (!allowed)
    return (
      <PageContainer>
        <PageHeader
          title="Zugriff verweigert"
          description="Die Geräteverwaltung ist Gerätemanagern und Administratoren vorbehalten."
        />
      </PageContainer>
    )

  return (
    <PageContainer>
      <PageHeader
        title="Geräte"
        description="Zentraler Gerätebestand des Device Inventory."
      />
      <p className="devices-feedback" role="status">
        {message}
      </p>
      <section className="devices-panel" aria-labelledby="devices-title">
        <div className="devices-toolbar">
          <h2 id="devices-title">Gerätebestand</h2>
          <button
            ref={newButton}
            className="devices-button devices-button--primary"
            disabled={creating}
            onClick={openCreate}
          >
            Gerät anlegen
          </button>
        </div>
        <p className="devices-help">
          Die Übersicht aller Geräte wird in einem separaten Arbeitspaket umgesetzt.
        </p>
      </section>
      {creating && (
        <section className="devices-panel" aria-labelledby="devices-editor-title">
          <h2 id="devices-editor-title">Gerät anlegen</h2>
          <form onSubmit={submit} aria-busy={saving}>
            <fieldset className="devices-fields" disabled={saving}>
              <legend className="sr-only">Gerätedaten</legend>
              <label>
                Geräte-ID
                <input
                  required
                  maxLength={100}
                  autoComplete="off"
                  value={form.asset_tag}
                  onChange={(event) => setForm({ ...form, asset_tag: event.target.value })}
                />
              </label>
              <label>
                Gerätetyp
                <input
                  required
                  maxLength={100}
                  autoComplete="off"
                  value={form.device_type}
                  onChange={(event) => setForm({ ...form, device_type: event.target.value })}
                />
              </label>
              <label>
                Hersteller
                <input
                  required
                  maxLength={100}
                  autoComplete="off"
                  value={form.manufacture}
                  onChange={(event) => setForm({ ...form, manufacture: event.target.value })}
                />
              </label>
              <label>
                Modell
                <input
                  required
                  maxLength={100}
                  autoComplete="off"
                  value={form.model}
                  onChange={(event) => setForm({ ...form, model: event.target.value })}
                />
              </label>
              <label>
                Seriennummer
                <input
                  required
                  maxLength={100}
                  autoComplete="off"
                  value={form.serial_number}
                  onChange={(event) => setForm({ ...form, serial_number: event.target.value })}
                />
              </label>
            </fieldset>

            <button
              type="button"
              className="devices-button devices-details-toggle"
              aria-expanded={detailsOpen}
              disabled={saving}
              onClick={() => setDetailsOpen((value) => !value)}
            >
              {detailsOpen ? 'Details ausblenden' : 'Details (optional)'}
            </button>

            {detailsOpen && (
              <fieldset className="devices-fields" disabled={saving}>
                <legend className="sr-only">Weitere Angaben</legend>
                <label>
                  Name
                  <input
                    maxLength={150}
                    autoComplete="off"
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </label>
                <label>
                  Betriebssystem
                  <input
                    maxLength={100}
                    autoComplete="off"
                    value={form.operating_system}
                    onChange={(event) => setForm({ ...form, operating_system: event.target.value })}
                  />
                </label>
                <label>
                  Prozessor
                  <input
                    maxLength={100}
                    autoComplete="off"
                    value={form.processor}
                    onChange={(event) => setForm({ ...form, processor: event.target.value })}
                  />
                </label>
                <label>
                  RAM (GB)
                  <input
                    type="number"
                    min={0}
                    value={form.ram_gb ?? ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        ram_gb: event.target.value === '' ? undefined : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Speicherplatz (GB)
                  <input
                    type="number"
                    min={0}
                    value={form.disk_space_gb ?? ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        disk_space_gb: event.target.value === '' ? undefined : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Standort
                  <input
                    maxLength={150}
                    autoComplete="off"
                    value={form.location}
                    onChange={(event) => setForm({ ...form, location: event.target.value })}
                  />
                </label>
                <label>
                  Device Usage
                  <input
                    maxLength={150}
                    autoComplete="off"
                    value={form.device_usage}
                    onChange={(event) => setForm({ ...form, device_usage: event.target.value })}
                  />
                </label>
                <label>
                  Kaufdatum
                  <input
                    type="date"
                    value={form.purchased_at}
                    onChange={(event) => setForm({ ...form, purchased_at: event.target.value })}
                  />
                </label>
                <label>
                  Start der Nutzung
                  <input
                    type="date"
                    value={form.start_of_use}
                    onChange={(event) => setForm({ ...form, start_of_use: event.target.value })}
                  />
                </label>
                <label>
                  Wartungsende
                  <input
                    type="date"
                    value={form.maintenance_end}
                    onChange={(event) => setForm({ ...form, maintenance_end: event.target.value })}
                  />
                </label>
                <label>
                  Beschreibung
                  <textarea
                    maxLength={2000}
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                </label>
                <label>
                  Kommentare
                  <textarea
                    maxLength={2000}
                    value={form.comments}
                    onChange={(event) => setForm({ ...form, comments: event.target.value })}
                  />
                </label>
              </fieldset>
            )}

            {formError && (
              <p className="devices-error" role="alert">
                {formError}
              </p>
            )}
            <div className="devices-actions">
              <button
                className="devices-button devices-button--primary"
                type="submit"
                disabled={saving}
              >
                {saving ? 'Wird gespeichert …' : 'Speichern'}
              </button>
              <button
                type="button"
                className="devices-button"
                disabled={saving}
                onClick={closeCreate}
              >
                Abbrechen
              </button>
            </div>
          </form>
        </section>
      )}
    </PageContainer>
  )
}
