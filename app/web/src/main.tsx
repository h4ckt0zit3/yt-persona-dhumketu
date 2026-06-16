import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import './index.css'

// Initialize theme from localStorage BEFORE first paint to avoid flash.
const savedTheme = (() => {
  try {
    return localStorage.getItem('yp-theme')
  } catch {
    return null
  }
})()
if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark')

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
)
