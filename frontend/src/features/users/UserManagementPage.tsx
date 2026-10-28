import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PageContainer } from '../../components/ui/PageContainer'
import { PageHeader } from '../../components/ui/PageHeader'
import { canAssignRole, hasPermission, type Role } from '../../config/permissions'
import { useAuthSession } from '../../hooks/useAuthSession'
import {
  UserApiError,
  userApi,
  type ManagedUser,
  type UserPage,
} from './userApi'
import './users.css'

const labels: Record<Role, string> = {
  super_admin: 'SuperAdmin',
  admin: 'Administrator',
  device_manager: 'Gerätemanager',
  employee: 'Mitarbeiter',
}
type Editor = {
  kind: 'create' | 'edit' | 'deactivate' | 'role'
  user: ManagedUser | null
}
const emptyForm = { first_name: '', last_name: '', email: '', password: '' }

export function UserManagementPage() {
  const { session, role, permissions, userId, isLoading, isRoleLoading, reloadProfile } =
    useAuthSession()
  const allowed =
    !!session &&
    !isLoading &&
    !isRoleLoading &&
    hasPermission(role, 'users:manage', permissions)
  const [result, setResult] = useState<UserPage>({ users: [], total: 0 })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [selectedRole, setSelectedRole] = useState<'admin' | 'device_manager' | 'employee'>('employee')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const firstInput = useRef<HTMLInputElement>(null)
  const roleInput = useRef<HTMLSelectElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const currentIdentity = useRef(userId)
  currentIdentity.current = userId

  useEffect(() => {
    let active = true
    setResult({ users: [], total: 0 })
    setLoadError('')
    setLoading(true)
    if (!allowed) return
    void userApi
      .list(page, search)
      .then((data) => {
        if (active) setResult(data)
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Benutzer konnten nicht geladen werden.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [allowed, userId, page, search, version])

  useEffect(() => {
    setEditor(null)
    setForm(emptyForm)
    setMessage('')
  }, [userId, allowed])

  useEffect(() => {
    if (editor?.kind === 'deactivate') cancelButton.current?.focus()
    else if (editor?.kind === 'role') roleInput.current?.focus()
    else if (editor) firstInput.current?.focus()
  }, [editor])

  function open(
    kind: Editor['kind'],
    user: ManagedUser | null,
    button: HTMLButtonElement,
  ) {
    trigger.current = button
    setForm({
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      email: user?.email ?? '',
      password: '',
    })
    setFormError('')
    setSelectedRole(user?.role === 'admin' ? 'admin' : user?.role === 'device_manager' ? 'device_manager' : 'employee')
    setMessage('')
    setEditor({ kind, user })
  }

  function close() {
    setEditor(null)
    setForm(emptyForm)
    setFormError('')
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus()
      else newButton.current?.focus()
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || busy.current || !allowed) return
    busy.current = true
    setSaving(true)
    setFormError('')
    const identity = userId
    try {
      if (editor.kind === 'create') await userApi.create(form)
      else if (editor.kind === 'role' && editor.user) await userApi.assignRole(editor.user.id, selectedRole)
      else if (editor.kind === 'edit' && editor.user)
        await userApi.update(editor.user.id, {
          first_name: form.first_name,
          last_name: form.last_name,
        })
      else if (editor.user) await userApi.deactivate(editor.user.id)
      if (currentIdentity.current !== identity) return
      setMessage(
        editor.kind === 'create'
          ? 'Benutzer angelegt.'
          : editor.kind === 'edit'
            ? 'Benutzerdaten gespeichert.'
            : editor.kind === 'role'
              ? 'Rolle gespeichert. Der Benutzer muss sich erneut anmelden.'
            : 'Benutzer deaktiviert. Anmeldung und geschützte Zugriffe sind gesperrt.',
      )
      if (editor.user?.id === userId) reloadProfile()
      close()
      setVersion((value) => value + 1)
    } catch (error) {
      if (currentIdentity.current !== identity) return
      const text =
        error instanceof Error
          ? error.message
          : 'Aktion fehlgeschlagen. Bitte erneut versuchen.'
      if (error instanceof UserApiError && error.code === 'ban_pending') {
        close()
        setMessage(text)
        setVersion((value) => value + 1)
      } else setFormError(text)
      // Do not keep a password after an unsuccessful network request.
      setForm((value) => ({ ...value, password: '' }))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  if (!allowed)
    return (
      <PageContainer>
        <PageHeader
          title="Zugriff verweigert"
          description="Die Benutzerverwaltung ist Administratoren vorbehalten."
        />
      </PageContainer>
    )

  return (
    <PageContainer>
      <PageHeader
        title="Benutzerverwaltung"
        description="Benutzerkonten anlegen, Stammdaten bearbeiten und Zugriffe sperren."
      />
      <p className="users-feedback" role="status">
        {message}
      </p>
      <section
        className="users-panel"
        aria-labelledby="users-title"
        aria-busy={loading}
      >
        <div className="users-toolbar">
          <h2 id="users-title">
            Benutzer <span className="users-count">{result.total}</span>
          </h2>
          <button
            ref={newButton}
            className="users-button users-button--primary"
            disabled={editor !== null || saving}
            onClick={(event) => open('create', null, event.currentTarget)}
          >
            Benutzer anlegen
          </button>
        </div>
        <form
          className="users-search"
          onSubmit={(event) => {
            event.preventDefault()
            setPage(0)
            setSearch(searchInput.trim())
            setVersion((value) => value + 1)
          }}
        >
          <label>
            Benutzer suchen
            <input
              type="search"
              maxLength={100}
              placeholder="Name, E-Mail oder Rollenname"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <button className="users-button" type="submit">
            Suchen
          </button>
        </form>
        {loading ? (
          <p role="status">Benutzer werden geladen …</p>
        ) : loadError ? (
          <div role="alert">
            <p>{loadError}</p>
            <button
              className="users-button"
              onClick={() => setVersion((value) => value + 1)}
            >
              Erneut versuchen
            </button>
          </div>
        ) : (
          <>
            {result.users.length === 0 ? (
              <p>
                {search
                  ? 'Keine passenden Benutzer gefunden.'
                  : 'Keine Benutzer auf dieser Seite vorhanden.'}
              </p>
            ) : (
              <div
                className="users-table-scroll"
                role="region"
                aria-label="Benutzerliste"
                tabIndex={0}
              >
                <table className="users-table">
                  <caption className="sr-only">
                    Benutzer mit Rollen und Kontostatus
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">E-Mail</th>
                      <th scope="col">Rolle</th>
                      <th scope="col">Status</th>
                      <th scope="col">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.users.map((user) => (
                      <tr key={user.id}>
                        <th scope="row">
                          {[user.first_name, user.last_name]
                            .filter(Boolean)
                            .join(' ') || 'Ohne Namen'}
                          {user.id === userId && (
                            <small className="users-self"> Dein Konto</small>
                          )}
                        </th>
                        <td>{user.email ?? '—'}</td>
                        <td>{labels[user.role]}</td>
                        <td>
                          <span className="users-badge">
                            {user.disabled_at
                              ? user.login_blocked
                                ? 'Deaktiviert'
                                : 'Anmeldesperre ausstehend'
                              : user.login_blocked
                                ? 'Auth-gesperrt'
                                : 'Aktiv'}
                          </span>
                        </td>
                        <td>
                          <div className="users-actions">
                            <button
                              className="users-button"
                              disabled={editor !== null || saving || (role !== 'super_admin' && ['admin','super_admin'].includes(user.role) && user.id !== userId) || (user.role === 'super_admin' && user.id !== userId)}
                              aria-label={`${user.first_name ?? ''} ${user.last_name ?? ''} bearbeiten`}
                              onClick={(event) =>
                                open('edit', user, event.currentTarget)
                              }
                            >
                              Bearbeiten
                            </button>
                            {!user.disabled_at && (['employee','device_manager','admin'] as Role[]).some(target => canAssignRole(role, user.role, target, user.id === userId)) && (
                              <button className="users-button" disabled={editor !== null || saving}
                                onClick={(event) => open('role', user, event.currentTarget)}>
                                Rolle zuweisen
                              </button>
                            )}
                            {(!user.disabled_at || !user.login_blocked) && (
                              <button
                                className="users-button users-button--danger"
                                disabled={
                                  editor !== null ||
                                  saving ||
                                  user.id === userId ||
                                  user.role === 'super_admin' ||
                                  (role !== 'super_admin' && user.role === 'admin')
                                }
                                title={
                                  user.id === userId
                                    ? 'Das eigene Konto kann nicht deaktiviert werden.'
                                    : undefined
                                }
                                onClick={(event) =>
                                  open('deactivate', user, event.currentTarget)
                                }
                              >
                                {user.disabled_at
                                  ? 'Sperre abschließen'
                                  : 'Deaktivieren'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <nav
              className="users-pagination"
              aria-label="Seiten der Benutzerliste"
            >
              <button
                className="users-button"
                disabled={page === 0 || editor !== null}
                onClick={() => setPage((value) => value - 1)}
              >
                Zurück
              </button>
              <span>
                Seite {page + 1} von {Math.max(1, Math.ceil(result.total / 25))}
              </span>
              <button
                className="users-button"
                disabled={(page + 1) * 25 >= result.total || editor !== null}
                onClick={() => setPage((value) => value + 1)}
              >
                Weiter
              </button>
            </nav>
          </>
        )}
      </section>
      {editor && (
        <section className="users-panel" aria-labelledby="users-editor-title">
          <h2 id="users-editor-title">
            {editor.kind === 'create'
              ? 'Benutzer anlegen'
              : editor.kind === 'edit'
                ? 'Benutzer bearbeiten'
                : editor.kind === 'role'
                  ? 'Rolle zuweisen'
                  : 'Benutzer deaktivieren'}
          </h2>
          <form onSubmit={submit} aria-busy={saving}>
            {editor.kind === 'role' ? (
              <div className="users-role-editor">
                <p className="users-help">Die neue Rolle wird sofort gespeichert. Aktive Sitzungen des Benutzers werden widerrufen.</p>
                <label htmlFor="assigned-role">Neue Rolle</label>
                <select id="assigned-role" ref={roleInput} value={selectedRole} disabled={saving}
                  onChange={event => setSelectedRole(event.target.value as typeof selectedRole)}>
                  <option value="employee">Mitarbeiter</option>
                  <option value="device_manager">Gerätemanager</option>
                  {role === 'super_admin' && <option value="admin">Administrator</option>}
                </select>
              </div>
            ) : editor.kind === 'deactivate' ? (
              <p>
                „
                {[editor.user?.first_name, editor.user?.last_name]
                  .filter(Boolean)
                  .join(' ') || editor.user?.email}
                “ deaktivieren? Das Konto bleibt erhalten. Geschützte Zugriffe
                werden gesperrt und die Anmeldung wird blockiert.
              </p>
            ) : (
              <>
                <p className="users-help">
                  {editor.kind === 'create'
                    ? 'Neue Benutzer erhalten die Rolle Mitarbeiter. Der Administrator bestätigt die E-Mail-Zuordnung und übermittelt das initiale Passwort über einen sicheren Kanal.'
                    : 'Bearbeitet werden Vor- und Nachname. E-Mail, Passwort und Rolle werden hier nicht geändert.'}
                </p>
                <fieldset className="users-fields" disabled={saving}>
                  <legend className="sr-only">Benutzerdaten</legend>
                  <label>
                    Vorname
                    <input
                      ref={firstInput}
                      name="first_name"
                      required
                      maxLength={100}
                      autoComplete="off"
                      value={form.first_name}
                      onChange={(event) =>
                        setForm({ ...form, first_name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Nachname
                    <input
                      name="last_name"
                      required
                      maxLength={100}
                      autoComplete="off"
                      value={form.last_name}
                      onChange={(event) =>
                        setForm({ ...form, last_name: event.target.value })
                      }
                    />
                  </label>
                  {editor.kind === 'create' && (
                    <>
                      <label>
                        E-Mail
                        <input
                          type="email"
                          name="email"
                          required
                          maxLength={254}
                          autoComplete="off"
                          value={form.email}
                          onChange={(event) =>
                            setForm({ ...form, email: event.target.value })
                          }
                        />
                      </label>
                      <div>
                        <label>
                          Initiales Passwort
                          <input
                            type="password"
                            name="password"
                            required
                            minLength={12}
                            maxLength={128}
                            autoComplete="new-password"
                            aria-describedby="users-password-help"
                            value={form.password}
                            onChange={(event) =>
                              setForm({ ...form, password: event.target.value })
                            }
                          />
                        </label>
                        <small id="users-password-help">
                          12 bis 128 Zeichen; zusätzliche
                          Supabase-Passwortregeln gelten ebenfalls.
                        </small>
                      </div>
                    </>
                  )}
                </fieldset>
              </>
            )}
            {formError && (
              <p className="users-error" role="alert">
                {formError}
              </p>
            )}
            <div className="users-actions">
              <button
                className={`users-button ${editor.kind === 'deactivate' ? 'users-button--danger' : 'users-button--primary'}`}
                type="submit"
                disabled={saving}
              >
                {saving
                  ? 'Wird ausgeführt …'
                  : editor.kind === 'deactivate'
                    ? 'Deaktivierung bestätigen'
                    : 'Speichern'}
              </button>
              <button
                ref={cancelButton}
                type="button"
                className="users-button"
                disabled={saving}
                onClick={close}
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
