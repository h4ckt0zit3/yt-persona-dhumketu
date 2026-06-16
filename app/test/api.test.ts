import { describe, expect, it } from 'vitest'
import { api } from '../src/api'
import { fakeEnv } from './helpers'
import type { Env } from '../src/types'

// api is the /api sub-app; routes are mounted without the /api prefix here.
function call(path: string, env: Env, init: RequestInit = {}) {
  return api.fetch(new Request(`http://localhost${path}`, init), env)
}

describe('ingest dev guard', () => {
  // With DEV_AUTH=true, requireAuth bypasses auth AND live scraping is blocked
  // (no webhook/cron locally to ever close the job). Verifies both endpoints
  // short-circuit before touching Apify/DB.
  for (const path of ['ingest-videos', 'ingest-transcripts', 'ingest-all']) {
    it(`blocks ${path} in local dev`, async () => {
      const res = await call(`/channels/CH1/${path}`, fakeEnv({ DEV_AUTH: 'true' }), { method: 'POST' })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('scrape_disabled_in_dev')
    })
  }
})
