import { useEffect, useState } from 'react'
import { PageContainer } from '../../components/ui/PageContainer'
import { PageHeader } from '../../components/ui/PageHeader'
import { editablePermissions, hasPermission, permissionLabels, type Permission } from '../../config/permissions'
import { useAuthSession } from '../../hooks/useAuthSession'
import { userApi } from '../users/userApi'
import '../users/users.css'

const roles = [
  { value: 'admin', label: 'Administrator' },
  { value: 'device_manager', label: 'Gerätemanager' },
  { value: 'employee', label: 'Mitarbeiter' },
] as const

type EditableRole = (typeof roles)[number]['value']
type Matrix = Record<EditableRole, Permission[]>
const empty: Matrix = { admin: [], device_manager: [], employee: [] }

export function RolePermissionsPage() {
  const { session, role, permissions, isLoading, isRoleLoading, userId } = useAuthSession()
  const allowed = !!session && !isLoading && !isRoleLoading && hasPermission(role, 'permissions:manage', permissions)
  const [matrix, setMatrix] = useState<Matrix>(empty)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<EditableRole | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true
    setMatrix(empty)
    setError('')
    setFeedback('')
    setLoading(true)
    if (allowed) {
      void userApi.getPermissions().then(data => {
        if (active) setMatrix(data)
      }).catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Rechte konnten nicht geladen werden.')
      }).finally(() => { if (active) setLoading(false) })
    }
    return () => { active = false }
  }, [allowed, userId, version])

  const toggle = (target: EditableRole, permission: Permission, checked: boolean) => {
    setMatrix(current => ({
      ...current,
      [target]: checked
        ? [...current[target].filter(value => value !== permission), permission]
        : current[target].filter(value => value !== permission),
    }))
    setFeedback('')
  }

  const save = async (target: EditableRole) => {
    if (!allowed || saving || loading || error) return
    setSaving(target)
    setFeedback('')
    setError('')
    try {
      await userApi.setPermissions(target, editablePermissions.filter(permission => matrix[target].includes(permission)))
      setFeedback(`Berechtigungen für ${roles.find(r => r.value === target)?.label} gespeichert. Betroffene Benutzer müssen sich erneut anmelden.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(null)
    }
  }

  if (!allowed) return (
    <PageContainer><PageHeader title="Zugriff verweigert" description="Nur SuperAdmins dürfen Rollenberechtigungen ändern." /></PageContainer>
  )

  return (
    <PageContainer>
      <PageHeader title="Rollen & Berechtigungen" description="Berechtigungen der Anwendungsrollen verwalten – ausschließlich für SuperAdmins." />
      <section className="users-panel" aria-busy={loading}>
        <h2>Rechte je Rolle</h2>
        <p className="users-help">Sicherheitskritische Rechte (Benutzerverwaltung, Admin-Ernennung, SuperAdmin) sind fest geschützt. Die hier veränderbaren Rechte wirken nach erneuter Anmeldung und aktivierter serverseitiger Berechtigungsabfrage.</p>
        {error && <div role="alert" className="users-error">{error} <button className="users-button" onClick={() => setVersion(v => v + 1)}>Erneut versuchen</button></div>}
        {feedback && <p role="status" className="users-feedback">{feedback}</p>}
        {loading ? <p role="status">Berechtigungen werden geladen …</p> : !error && (
          <div className="users-table-scroll" role="region" aria-label="Rollenberechtigungen" tabIndex={0}>
            <table className="users-table users-permission-table">
              <thead><tr><th scope="col">Berechtigung</th>{roles.map(r => <th scope="col" key={r.value}>{r.label}</th>)}</tr></thead>
              <tbody>{editablePermissions.map(permission => (
                <tr key={permission}>
                  <th scope="row">{permissionLabels[permission]}</th>
                  {roles.map(target => (
                    <td key={target.value}>
                      <label className="users-permission-checkbox">
                        <input type="checkbox" aria-label={`${permissionLabels[permission]} – ${target.label}`}
                          checked={matrix[target.value].includes(permission)} disabled={saving !== null}
                          onChange={event => toggle(target.value, permission, event.target.checked)} />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}</tbody>
              <tfoot><tr><th scope="row">Änderungen speichern</th>{roles.map(target => (
                <td key={target.value}><button type="button" className="users-button users-button--primary"
                  disabled={saving !== null} onClick={() => void save(target.value)}>{saving === target.value ? 'Speichert …' : 'Speichern'}</button></td>
              ))}</tr></tfoot>
            </table>
          </div>
        )}
      </section>
    </PageContainer>
  )
}
