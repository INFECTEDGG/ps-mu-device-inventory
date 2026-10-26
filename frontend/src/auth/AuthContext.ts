import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Role } from '../config/permissions'

export interface AuthState {
  session: Session | null
  user: User | null
  userId: string | null
  role: Role | null
  isLoading: boolean
  isRoleLoading: boolean
  isSigningOut: boolean
  profileError: string | null
  sessionNotice: string | null
  clearSessionNotice: () => void
  reloadProfile: () => void
}

export const AuthContext = createContext<AuthState | null>(null)
