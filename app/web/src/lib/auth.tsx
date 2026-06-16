import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { getSupabase, getBootstrap } from './supabase'

interface AuthState {
  ready: boolean
  devMode: boolean
  client: SupabaseClient | null
  session: Session | null
  email: string | null
  error: string | null
  signIn: (email: string) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// A minimal stand-in session for local dev auto-login. RequireAuth only needs a
// truthy session + user.email; the worker auth gate is bypassed via DEV_AUTH so
// no real token is validated.
function devSession(email: string): Session {
  return {
    access_token: 'dev-bypass',
    refresh_token: 'dev-bypass',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 9999999999,
    user: { id: 'dev', email, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  } as unknown as Session
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsub: { unsubscribe: () => void } | undefined

    getBootstrap()
      .then(async (cfg) => {
        if (cancelled) return

        // Local-dev bypass: skip Supabase entirely, auto-sign-in.
        if (cfg.dev_auth) {
          setDevMode(true)
          setAccessToken('dev-bypass')
          setSession(devSession(cfg.dev_email || 'dev@local'))
          setReady(true)
          return
        }

        const sb = await getSupabase()
        if (cancelled) return
        setClient(sb)
        const { data } = await sb.auth.getSession()
        if (cancelled) return
        setSession(data.session ?? null)
        setAccessToken(data.session?.access_token ?? null)
        const sub = sb.auth.onAuthStateChange((_event, s) => {
          setSession(s)
          setAccessToken(s?.access_token ?? null)
        })
        unsub = sub.data.subscription
        setReady(true)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setReady(true)
      })

    return () => {
      cancelled = true
      unsub?.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      ready,
      devMode,
      client,
      session,
      email: session?.user?.email ?? null,
      error,
      signIn: async (email: string) => {
        if (!client) throw new Error('Auth not ready')
        const redirectTo = `${window.location.origin}/auth/callback`
        const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
        if (error) throw new Error(error.message)
      },
      signInWithPassword: async (email: string, password: string) => {
        if (!client) throw new Error('Auth not ready')
        const { error } = await client.auth.signInWithPassword({ email, password })
        if (error) throw new Error(error.message)
      },
      signOut: async () => {
        if (devMode) return // nothing to sign out of in dev
        if (!client) return
        await client.auth.signOut()
      },
    }),
    [client, session, ready, devMode, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function getAccessToken(): string | null {
  return cachedToken
}

let cachedToken: string | null = null
export function setAccessToken(t: string | null) {
  cachedToken = t
}
