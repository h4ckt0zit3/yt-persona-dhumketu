import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types'

// Public paths (no auth needed). Path is matched WITHOUT the /api prefix
// because this middleware mounts on the /api Hono sub-app.
const PUBLIC_EXACT = new Set(['/health', '/config'])
const PUBLIC_PREFIXES = ['/webhooks/']

export type AuthVars = { userEmail: string }

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }> = async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/^\/api/, '') || '/'
  if (PUBLIC_EXACT.has(path)) return next()
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return next()

  // Local-dev bypass: skip Supabase entirely so testing needs no email/login.
  // Guarded by DEV_AUTH, which lives only in .dev.vars and is never set in prod.
  if (c.env.DEV_AUTH === 'true') {
    c.set('userEmail', c.env.DEV_EMAIL || 'dev@local')
    return next()
  }

  const header = c.req.header('authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return c.json({ error: 'unauthorized', code: 'unauthorized', retryable: false }, 401)

  const res = await fetch(`${c.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      authorization: `Bearer ${token}`,
      apikey: c.env.SUPABASE_ANON_KEY,
    },
  })
  if (!res.ok) return c.json({ error: 'invalid session', code: 'unauthorized', retryable: false }, 401)

  const user = (await res.json()) as { email?: string; aud?: string }
  if (!user.email) return c.json({ error: 'no email on user', code: 'unauthorized', retryable: false }, 401)

  const allowlist = (c.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.length > 0 && !allowlist.includes(user.email.toLowerCase())) {
    return c.json(
      { error: 'email not authorized for this workspace', code: 'forbidden', retryable: false },
      403,
    )
  }

  c.set('userEmail', user.email)
  return next()
}
