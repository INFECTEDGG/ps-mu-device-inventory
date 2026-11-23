import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import './interaction.css'

interface RevealPanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
  /** Changes when another item opens in the same panel. */
  focusKey: string
}

/** Brings an action's newly opened panel into view and announces its heading. */
export function RevealPanel({ children, focusKey, className = '', ...attributes }: RevealPanelProps) {
  const panelRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const heading = panel.querySelector<HTMLElement>('h2')
      if (heading) {
        heading.tabIndex = -1
        heading.focus({ preventScroll: true })
      }
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      panel.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusKey])

  return <section {...attributes} ref={panelRef} className={`interaction-reveal ${className}`.trim()}>
    {children}
  </section>
}
