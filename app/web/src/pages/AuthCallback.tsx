import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function AuthCallback() {
  const { ready, session, error } = useAuth()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 5000)
    return () => clearTimeout(t)
  }, [])

  if (ready && session) return <Navigate to="/" replace />
  if (ready && !session && timedOut) return <Navigate to="/sign-in" replace />

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="text-center">
        <p className="font-display text-2xl font-normal tracking-tighter text-ink">
          Signing you <em className="italic text-accent">in</em>…
        </p>
        <p className="mt-2 text-sm text-muted">One moment while we confirm your link.</p>
        {error && <p className="mt-4 text-sm text-error" aria-live="polite">{error}</p>}
      </div>
    </div>
  )
}
