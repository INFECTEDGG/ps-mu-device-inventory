// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RevealPanel } from './RevealPanel'
import { ActionNotice } from './ActionNotice'

describe('Aktionen werden sichtbar gemacht', () => {
  const scroll = vi.fn()

  beforeEach(() => {
    scroll.mockClear()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('scrollt und fokussiert das geöffnete Bearbeitungsformular', () => {
    render(<RevealPanel focusKey="device-1"><h2>Gerät bearbeiten</h2></RevealPanel>)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Gerät bearbeiten' }))
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('scrollt erneut beim Wechsel auf ein anderes Gerät', () => {
    const { rerender } = render(<RevealPanel focusKey="device-1"><h2>Details</h2></RevealPanel>)
    rerender(<RevealPanel focusKey="device-2"><h2>Details</h2></RevealPanel>)
    expect(scroll).toHaveBeenCalledTimes(2)
  })

  it('zeigt eine Erfolgsmeldung mit Fokus und Scrollverhalten', () => {
    render(<ActionNotice>Gerät gespeichert.</ActionNotice>)
    const notice = screen.getByRole('status')
    expect(notice.textContent).toBe('Gerät gespeichert.')
    expect(document.activeElement).toBe(notice)
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('zeigt ohne Nachricht keine leere Meldung', () => {
    render(<ActionNotice>{''}</ActionNotice>)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('markiert Fehler eindeutig als Warnmeldung', () => {
    render(<ActionNotice variant="error">Aktion fehlgeschlagen.</ActionNotice>)
    expect(screen.getByRole('alert').textContent).toBe('Aktion fehlgeschlagen.')
  })
})
