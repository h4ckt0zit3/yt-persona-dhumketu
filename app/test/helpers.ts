import { vi } from 'vitest'
import type { Env } from '../src/types'

// Build a fake Env object good enough for unit tests. Override per-test
// with `{ ...fakeEnv(), SUPABASE_URL: 'https://other' }`.
export function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: { run: vi.fn() } as any,
    ASSETS: { fetch: vi.fn() } as any,
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_ANON_KEY: 'fake-anon-key',
    ALLOWED_EMAILS: 'allowed@example.com',
    LLM_PROVIDER: 'openai',
    CHAT_MODEL: 'qwen/qwen-2.5-72b-instruct',
    EMBED_PROVIDER: 'workers-ai',
    EMBED_MODEL: '@cf/baai/bge-large-en-v1.5',
    MAX_VIDEOS_PER_CHANNEL: '5',
    APIFY_VIDEO_ACTOR: 'streamers/youtube-scraper',
    APIFY_TRANSCRIPT_ACTOR: 'pintostudio/youtube-transcript-scraper',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role',
    APIFY_TOKEN: 'fake-apify-token',
    ANTHROPIC_API_KEY: 'fake-anthropic-key',
    OPENAI_API_KEY: 'fake-openai-key',
    WEBHOOK_SECRET: 'fake-webhook-secret',
    OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    ...overrides,
  } as Env
}

// Mock a single fetch call. Returns the spy so the test can assert on call args.
export function mockFetchOnce(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200
  const spy = vi.fn().mockResolvedValueOnce(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

// Mock a Supabase query-builder shape that's good enough for our handlers.
// Each method returns `this` (chainable) except terminal methods which return
// a Promise of { data, error, count? }.
type QueryResult = { data?: unknown; error?: unknown; count?: number }

export function fakeSupabase(scenarios: Record<string, QueryResult | ((args: any) => QueryResult)>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []

  function maybeAwait(table: string) {
    // Resolve to the registered scenario when awaited.
    const result = scenarios[table]
    return typeof result === 'function' ? result({}) : (result ?? { data: null, error: null })
  }

  function chain(table: string) {
    const inner = {
      _calls: [] as Array<{ method: string; args: unknown[] }>,
      select: (..._args: unknown[]) => (inner._calls.push({ method: 'select', args: _args }), inner),
      insert: (..._args: unknown[]) => Promise.resolve(maybeAwait(table)),
      upsert: (..._args: unknown[]) => Promise.resolve(maybeAwait(table)),
      update: (..._args: unknown[]) => (inner._calls.push({ method: 'update', args: _args }), inner),
      delete: (..._args: unknown[]) => (inner._calls.push({ method: 'delete', args: _args }), inner),
      eq: (..._args: unknown[]) => (inner._calls.push({ method: 'eq', args: _args }), inner),
      in: (..._args: unknown[]) => (inner._calls.push({ method: 'in', args: _args }), inner),
      not: (..._args: unknown[]) => (inner._calls.push({ method: 'not', args: _args }), inner),
      order: (..._args: unknown[]) => (inner._calls.push({ method: 'order', args: _args }), inner),
      limit: (..._args: unknown[]) => (inner._calls.push({ method: 'limit', args: _args }), inner),
      maybeSingle: () => Promise.resolve(maybeAwait(table)),
      single: () => Promise.resolve(maybeAwait(table)),
      then: (resolve: (v: QueryResult) => void) => resolve(maybeAwait(table)),
    }
    return inner
  }

  return {
    from: (table: string) => {
      calls.push({ table, method: 'from', args: [] })
      return chain(table)
    },
    _calls: calls,
  }
}
