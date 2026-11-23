// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DISPLAY_PREFERENCES, applyDisplayPreferences,
  normalizeDisplayPreferences, readDisplayPreferences, saveDisplayPreferences,
} from './displayPreferences'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-accent')
  document.documentElement.removeAttribute('data-density')
  document.documentElement.removeAttribute('data-reduce-motion')
})

describe('Display preferences', () => {
  it('rejects unknown stored options', () => {
    expect(normalizeDisplayPreferences({ theme: 'untrusted', accent: 'unknown', compactTables: 'yes' }))
      .toEqual(DEFAULT_DISPLAY_PREFERENCES)
  })
  it('applies dark mode, accent color and compact layout immediately', () => {
    applyDisplayPreferences({ theme: 'dark', accent: 'purple', compactTables: true, reduceMotion: true })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.accent).toBe('purple')
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.dataset.reduceMotion).toBe('true')
  })
  it('persists choices across reads', () => {
    const preferences = { theme: 'light', accent: 'green', compactTables: false, reduceMotion: true } as const
    expect(saveDisplayPreferences(preferences)).toBe(true)
    expect(readDisplayPreferences()).toEqual(preferences)
  })
})
