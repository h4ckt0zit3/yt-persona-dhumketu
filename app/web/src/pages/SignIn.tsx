import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function SignIn() {
  const { ready, session, error: authError, signIn, signInWithPassword } = useAuth()
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  if (ready && session) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || sending) return
    if (mode === 'password' && !password) return
    setSending(true)
    setErr('')
    try {
      if (mode === 'password') {
        await signInWithPassword(email.trim(), password)
        // navigation happens once the auth state updates session
      } else {
        await signIn(email.trim())
        setSent(true)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-[420px] rounded-lg border border-edge bg-surface px-12 py-14 shadow-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <BrandMark />
          <span className="font-display text-lg font-medium tracking-tighter">YouTube Personas</span>
        </div>

        <h1 className="text-center font-display text-3xl font-normal leading-tight tracking-tighter">
          Welcome <em className="italic text-accent" style={{ fontVariationSettings: '"opsz" 144' }}>back</em>.
        </h1>
        <p className="mt-2 mb-7 text-center text-sm text-muted">
          {mode === 'password'
            ? 'Sign in with your shared workspace credentials.'
            : "We'll email you a one-click link. No password to forget."}
        </p>

        {sent ? (
          <div className="rounded-sm border border-success bg-success-soft px-4 py-3 text-sm text-success">
            Check <span className="font-mono">{email}</span> — your sign-in link is on its way.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3.5">
            <div>
              <label htmlFor="signin-email" className="mb-1.5 block text-xs font-medium text-ink-2">
                Email address
              </label>
              <input
                id="signin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={sending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input"
                autoFocus
              />
            </div>
            {mode === 'password' && (
              <div>
                <label htmlFor="signin-password" className="mb-1.5 block text-xs font-medium text-ink-2">
                  Password
                </label>
                <input
                  id="signin-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={sending}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={!ready || sending || !email.trim() || (mode === 'password' && !password)}
              className="btn-primary w-full"
            >
              {sending
                ? mode === 'password'
                  ? 'Signing in…'
                  : 'Sending…'
                : !ready
                  ? 'Loading…'
                  : mode === 'password'
                    ? 'Sign in'
                    : 'Send magic link'}
            </button>
            {(err || authError) && (
              <p className="text-center text-sm text-error" aria-live="polite">
                {err || authError}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === 'password' ? 'magic' : 'password'))
                setErr('')
                setSent(false)
              }}
              className="w-full text-center text-xs font-medium text-muted hover:text-accent"
            >
              {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center font-mono text-[11px] text-muted">
          Access is invite-only · contact your workspace admin
        </p>
      </div>
    </div>
  )
}

function BrandMark() {
  return (
    <div
      className="grid h-8 w-8 place-items-center rounded-md text-sm font-bold text-white shadow-sm"
      style={{ background: 'linear-gradient(135deg, var(--accent), #E07B6E)' }}
    >
      YP
    </div>
  )
}
