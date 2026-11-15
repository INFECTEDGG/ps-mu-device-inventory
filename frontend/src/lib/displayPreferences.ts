/** Personal browser-only display preferences. Never sent to Supabase. */
export type ThemePreference = 'system' | 'light' | 'dark'
export type AccentPreference = 'blue' | 'green' | 'teal' | 'purple' | 'orange'

export interface DisplayPreferences {
  compactTables: boolean
  reduceMotion: boolean
  theme: ThemePreference
  accent: AccentPreference
}

const STORAGE_KEY = 'device-inventory:display-preferences:v1'
const themes: readonly ThemePreference[] = ['system', 'light', 'dark']
const accents: readonly AccentPreference[] = ['blue', 'green', 'teal', 'purple', 'orange']

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  compactTables: false,
  reduceMotion: false,
  theme: 'system',
  accent: 'blue',
}

export function normalizeDisplayPreferences(value: unknown): DisplayPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_DISPLAY_PREFERENCES }
  }
  const options = value as Record<string, unknown>
  return {
    compactTables: options.compactTables === true,
    reduceMotion: options.reduceMotion === true,
    theme: themes.find(item => item === options.theme) ?? 'system',
    accent: accents.find(item => item === options.accent) ?? 'blue',
  }
}

export function readDisplayPreferences(): DisplayPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeDisplayPreferences(JSON.parse(raw) as unknown) : { ...DEFAULT_DISPLAY_PREFERENCES }
  } catch {
    return { ...DEFAULT_DISPLAY_PREFERENCES }
  }
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyDisplayPreferences(preferences: DisplayPreferences): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.density = preferences.compactTables ? 'compact' : 'normal'
  root.dataset.reduceMotion = preferences.reduceMotion ? 'true' : 'false'
  root.dataset.theme = preferences.theme === 'system' ? (systemDark() ? 'dark' : 'light') : preferences.theme
  root.dataset.themePreference = preferences.theme
  root.dataset.accent = preferences.accent
}

export function saveDisplayPreferences(preferences: DisplayPreferences): boolean {
  applyDisplayPreferences(preferences)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    return true
  } catch {
    return false
  }
}

let systemThemeListenerInstalled = false
export function initializeDisplayPreferences(): void {
  applyDisplayPreferences(readDisplayPreferences())
  if (systemThemeListenerInstalled || typeof window.matchMedia !== 'function') return
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener?.('change', () => {
    const current = readDisplayPreferences()
    if (current.theme === 'system') applyDisplayPreferences(current)
  })
  systemThemeListenerInstalled = true
}
