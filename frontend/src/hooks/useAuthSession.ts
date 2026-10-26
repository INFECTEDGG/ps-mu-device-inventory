import { useContext } from 'react'
import { AuthContext } from '../auth/AuthContext'

export function useAuthSession() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuthSession benötigt einen AuthProvider.')
  return auth
}
