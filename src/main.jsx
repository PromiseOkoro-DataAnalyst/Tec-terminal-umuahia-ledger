import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AuthProvider from './context/AuthProvider'
import ToastProvider from './components/ToastProvider'
import { supabaseConfigured } from './lib/supabase'
import { NotConfigured } from './pages/Auth'
import App from './App'
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css'
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/fraunces/opsz-italic.css'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {supabaseConfigured ? (
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    ) : (
      <NotConfigured />
    )}
  </StrictMode>,
)
