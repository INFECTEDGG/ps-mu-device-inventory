import { useCallback, useEffect, useState, type MouseEvent } from 'react'

const normalizePath = (path: string) => {
  if (path === '/') return path
  return path.replace(/\/+$/, '') || '/'
}

export function useAppNavigation() {
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname))

  useEffect(() => {
    const handlePopState = () => setCurrentPath(normalizePath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((path: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    event.preventDefault()
    const nextPath = normalizePath(path)

    if (nextPath !== normalizePath(window.location.pathname)) {
      window.history.pushState({}, '', nextPath)
      setCurrentPath(nextPath)
    }
  }, [])

  return { currentPath, navigate }
}
