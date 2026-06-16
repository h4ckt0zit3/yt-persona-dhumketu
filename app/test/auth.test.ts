import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { requireAuth, type AuthVars } from '../src/lib/auth'
import type { Env } from '../src/types'
import { fakeEnv } from './helpers'

function buildApp(env: Env) {
  const app = new Hono<{ Bindings: Env; Variables: AuthVars }>()
  app.use('*', requireAuth)
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/config', (c) => c.json({ public: true }))
  app.get('/api/webhooks/apify', (c) => c.json({ webhook: true }))
  app.get('/api/protected', (c) => c.json({ email: c.get('userEmail') }))
  return {
    fetch: (path: string, init: RequestInit = {}) =>
      app.fetch(new Request(`http://localhost${path}`, init), env),
  }
}

describe('requireAuth middleware', () => {
  let app: ReturnType<typeof buildApp>

  beforeEach(() => {
    app = buildApp(fakeEnv())
  })

  it('bypasses auth for /api/health', async () => {
    const res = await app.fetch('/api/health')
    expect(res.status).toBe(200)
  })

  it('bypasses auth for /api/config', async () => {
    const res = await app.fetch('/api/config')
    expect(res.status).toBe(200)
  })

  it('bypasses auth for /api/webhooks/*', async () => {
    const res = await app.fetch('/api/webhooks/apify')
    expect(res.status).toBe(200)
  })

  it('returns 401 with code=unauthorized when no Authorization header', async () => {
    const res = await app.fetch('/api/protected')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string; retryable: boolean }
    expect(body).toMatchObject({ code: 'unauthorized', retryable: false })
  })

  it('returns 401 when Supabase rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('bad', { status: 401 })),
    )
    const res = await app.fetch('/api/protected', { headers: { authorization: 'Bearer xyz' } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when Supabase returns user with no email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ aud: 'x' }), { status: 200 })),
    )
    const res = await app.fetch('/api/protected', { headers: { authorization: 'Bearer xyz' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when email is not in allowlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ email: 'evil@example.com' }), { status: 200 }),
      ),
    )
    const res = await app.fetch('/api/protected', { headers: { authorization: 'Bearer xyz' } })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('forbidden')
  })

  it('allows allowlisted email and sets userEmail in context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ email: 'allowed@example.com' }), { status: 200 }),
      ),
    )
    const res = await app.fetch('/api/protected', { headers: { authorization: 'Bearer xyz' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string }
    expect(body.email).toBe('allowed@example.com')
  })

  it('allowlist is case-insensitive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ email: 'ALLOWED@example.com' }), { status: 200 }),
      ),
    )
    const res = await app.fetch('/api/protected', { headers: { authorization: 'Bearer xyz' } })
    expect(res.status).toBe(200)
  })

  it('with empty ALLOWED_EMAILS, allows any verified email', async () => {
    app = buildApp(fakeEnv({ ALLOWED_EMAILS: '' }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ email: 'anyone@example.com' }), { status: 200 }),
      ),
    )
    const res = await app.fetch('/api/protected', { headers: { authorization: 'Bearer xyz' } })
    expect(res.status).toBe(200)
  })

  it('handles Bearer prefix case-insensitively', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ email: 'allowed@example.com' }), { status: 200 }),
      ),
    )
    const res = await app.fetch('/api/protected', { headers: { authorization: 'bearer xyz' } })
    expect(res.status).toBe(200)
  })
})
