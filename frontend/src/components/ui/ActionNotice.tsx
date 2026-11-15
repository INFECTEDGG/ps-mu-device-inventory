import { useLayoutEffect, useRef } from 'react'
import './interaction.css'

interface ActionNoticeProps {
  children: string
  className?: string
  variant?: 'success' | 'error'
}

/** Feedback is scroll-revealed because users may save at the bottom of a long form. */
export function ActionNotice({ children, className = '', variant = 'success' }: ActionNoticeProps) {
  const ref = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    if (!children) return
    const frame = requestAnimationFrame(() => {
      const notice = ref.current
      if (!notice) return
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      notice.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
      notice.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [children])

  if (!children) return null
  return <p ref={ref} tabIndex={-1} role={variant === 'error' ? 'alert' : 'status'}
    className={`interaction-notice interaction-notice--${variant} ${className}`.trim()}>{children}</p>
}
