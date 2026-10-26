import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {Analytics} from '@vercel/analytics/react'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
    <Analytics />
  </StrictMode>,
)
