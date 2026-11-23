import { useEffect, useState, type FormEvent } from 'react'
import { ActionNotice } from '../../components/ui/ActionNotice'
import { PageContainer } from '../../components/ui/PageContainer'
import { PageHeader } from '../../components/ui/PageHeader'
import { useAuthSession } from '../../hooks/useAuthSession'
import {
  readDisplayPreferences, saveDisplayPreferences, type DisplayPreferences,
  type ThemePreference, type AccentPreference,
} from '../../lib/displayPreferences'
import { settingsApi, SettingsApiError, type OwnProfile } from './settingsApi'
import './settings.css'

const roleLabels: Record<string, string> = {
  super_admin: 'SuperAdmin', admin: 'Administrator', device_manager: 'Gerätemanager', employee: 'Mitarbeiter',
}

export function SettingsPage() {
  const { user, role, userId, session } = useAuthSession()
  const [profile, setProfile] = useState<OwnProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileVersion, setProfileVersion] = useState(0)
  const [prefs, setPrefs] = useState<DisplayPreferences>(() => readDisplayPreferences())
  const [prefsNotice, setPrefsNotice] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!session || !userId) return
    let active = true
    setProfileLoading(true)
    setProfileError('')
    void settingsApi.ownProfile().then(data => {
      if (active) setProfile(data)
    }).catch(() => {
      if (active) { setProfile(null); setProfileError('Profildaten konnten nicht geladen werden.') }
    }).finally(() => { if (active) setProfileLoading(false) })
    return () => { active = false }
  }, [session?.user.id, userId, profileVersion])

  function updatePreference<K extends keyof DisplayPreferences>(field: K, value: DisplayPreferences[K]) {
    const next = { ...prefs, [field]: value }
    setPrefs(next)
    setPrefsNotice(saveDisplayPreferences(next)
      ? 'Anzeigeeinstellung gespeichert. Sie gilt für diesen Browser.'
      : 'Einstellung angewendet, konnte aber in diesem Browser nicht dauerhaft gespeichert werden.')
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setPasswordError('')
    setSuccess('')
    try {
      await settingsApi.updatePassword(password, confirmation)
      setPassword('')
      setConfirmation('')
      setSuccess('Dein Passwort wurde erfolgreich aktualisiert.')
    } catch (error) {
      setPasswordError(error instanceof SettingsApiError ? error.message : 'Passwort konnte nicht geändert werden.')
    } finally {
      setSaving(false)
    }
  }

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
  return <PageContainer>
    <PageHeader title="Einstellungen" description="Dein Benutzerkonto und deine persönlichen Anzeigeoptionen verwalten." />

    <section className="settings-panel" aria-labelledby="settings-profile-title">
      <div className="settings-heading"><h2 id="settings-profile-title">Mein Benutzerprofil</h2>
        <button type="button" className="settings-button" onClick={() => setProfileVersion(v => v + 1)} disabled={profileLoading}>
          Aktualisieren
        </button></div>
      {profileLoading && <p role="status" className="settings-help">Profildaten werden geladen …</p>}
      {profileError && <p role="alert" className="settings-error">{profileError}</p>}
      <dl className="settings-profile-grid">
        <div><dt>Name</dt><dd>{displayName || (profileLoading ? 'Wird geladen …' : 'Nicht hinterlegt')}</dd></div>
        <div><dt>E-Mail-Adresse</dt><dd>{user?.email ?? '–'}</dd></div>
        <div><dt>Rolle</dt><dd>{role ? (roleLabels[role] ?? role) : '–'}</dd></div>
      </dl>
      <p className="settings-help">Name und Rolle werden über die Benutzerverwaltung gepflegt. Hier kannst du nur dein eigenes Passwort und deine Anzeigeoptionen ändern.</p>
    </section>

    <section className="settings-panel" aria-labelledby="settings-password-title">
      <h2 id="settings-password-title">Passwort ändern</h2>
      <p className="settings-help">Das neue Passwort muss mindestens 12 Zeichen enthalten. Supabase kann zusätzliche Sicherheitsprüfungen verlangen.</p>
      {success && <ActionNotice>{success}</ActionNotice>}
      <form onSubmit={event => void changePassword(event)} className="settings-form" aria-busy={saving}>
        <label htmlFor="settings-new-password">Neues Passwort
          <input id="settings-new-password" type="password" required minLength={12} maxLength={128}
            autoComplete="new-password" value={password} disabled={saving}
            onChange={e => setPassword(e.target.value)} />
        </label>
        <label htmlFor="settings-confirm-password">Neues Passwort bestätigen
          <input id="settings-confirm-password" type="password" required minLength={12} maxLength={128}
            autoComplete="new-password" value={confirmation} disabled={saving}
            onChange={e => setConfirmation(e.target.value)} />
        </label>
        {passwordError && <p role="alert" className="settings-error">{passwordError}</p>}
        <div><button className="settings-button settings-button--primary" type="submit" disabled={saving}>
          {saving ? 'Passwort wird geändert …' : 'Passwort aktualisieren'}
        </button></div>
      </form>
    </section>

    <section className="settings-panel" aria-labelledby="settings-appearance-title">
      <h2 id="settings-appearance-title">Design & Farben</h2>
      <p className="settings-help">Wähle ein Design für die gesamte Anwendung. Die Einstellung wird sofort übernommen.</p>
      <fieldset className="settings-choice-fieldset">
        <legend>Darstellungsmodus</legend>
        <div className="settings-choice-grid" role="group" aria-label="Darstellungsmodus">
          {([
            ['light', 'Hell', 'Heller Hintergrund'],
            ['dark', 'Dunkel', 'Augenfreundliche dunkle Oberfläche'],
            ['system', 'System', 'Windows-Einstellung übernehmen'],
          ] as const).map(([value, label, help]) => <label className="settings-choice" key={value}>
            <input type="radio" name="appearance" value={value} checked={prefs.theme === value}
              onChange={() => updatePreference('theme', value as ThemePreference)} />
            <span><strong>{label}</strong><small>{help}</small></span>
          </label>)}
        </div>
      </fieldset>
      <fieldset className="settings-choice-fieldset">
        <legend>Akzentfarbe</legend>
        <div className="settings-accent-grid" role="group" aria-label="Akzentfarbe">
          {([
            ['blue', 'Blau'], ['green', 'Grün'], ['teal', 'Türkis'],
            ['purple', 'Lila'], ['orange', 'Orange'],
          ] as const).map(([value, label]) => <label className="settings-accent-choice" key={value}>
            <input type="radio" name="accent" value={value} checked={prefs.accent === value}
              onChange={() => updatePreference('accent', value as AccentPreference)} />
            <span className={`settings-color-dot settings-color-dot--${value}`} aria-hidden="true" />
            <span>{label}</span>
          </label>)}
        </div>
      </fieldset>
      {prefsNotice && <p role="status" className="settings-saved">{prefsNotice}</p>}
    </section>

    <section className="settings-panel" aria-labelledby="settings-display-title">
      <h2 id="settings-display-title">Darstellung & Bedienung</h2>
      <p className="settings-help">Diese Einstellungen werden nur in deinem Browser gespeichert, nicht in Supabase.</p>
      <div className="settings-options">
        <label className="settings-option" htmlFor="settings-compact">
          <span><strong>Kompakte Tabellen</strong><small>Weniger Abstand zwischen den Zeilen in Geräte-, Benutzer- und Zuweisungslisten.</small></span>
          <input id="settings-compact" type="checkbox" checked={prefs.compactTables}
            onChange={e => updatePreference('compactTables', e.target.checked)} />
        </label>
        <label className="settings-option" htmlFor="settings-motion">
          <span><strong>Animationen reduzieren</strong><small>Formulare und Erfolgsmeldungen ohne weiches Scrollen anzeigen.</small></span>
          <input id="settings-motion" type="checkbox" checked={prefs.reduceMotion}
            onChange={e => updatePreference('reduceMotion', e.target.checked)} />
        </label>
      </div>
    </section>
  </PageContainer>
}
