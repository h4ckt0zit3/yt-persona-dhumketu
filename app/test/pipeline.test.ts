import { describe, expect, it, vi } from 'vitest'
import { fakeEnv, fakeSupabase } from './helpers'

// cancelJob + failJob reach the DB via getDb(); point it at a per-test fake.
let fakeDb: ReturnType<typeof fakeSupabase>
vi.mock('../src/lib/supabase', () => ({
  getDb: () => fakeDb,
  vecLiteral: (v: number[]) => JSON.stringify(v),
}))

import { liveScrapeDisabled, jobAgeExceeded, cancelJob } from '../src/lib/pipeline'

describe('liveScrapeDisabled', () => {
  it('is true only when DEV_AUTH === "true"', () => {
    expect(liveScrapeDisabled(fakeEnv({ DEV_AUTH: 'true' }))).toBe(true)
    expect(liveScrapeDisabled(fakeEnv({ DEV_AUTH: 'false' }))).toBe(false)
    expect(liveScrapeDisabled(fakeEnv({ DEV_AUTH: undefined }))).toBe(false)
  })
})

describe('jobAgeExceeded', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0) // fixed reference time

  it('false for a fresh job (5 min old, budget 15)', () => {
    const started = new Date(now - 5 * 60_000).toISOString()
    expect(jobAgeExceeded(started, now, 15)).toBe(false)
  })

  it('true for a stale job (20 min old, budget 15)', () => {
    const started = new Date(now - 20 * 60_000).toISOString()
    expect(jobAgeExceeded(started, now, 15)).toBe(true)
  })

  it('false exactly at the boundary, true just past it', () => {
    expect(jobAgeExceeded(new Date(now - 15 * 60_000).toISOString(), now, 15)).toBe(false)
    expect(jobAgeExceeded(new Date(now - 15 * 60_000 - 1000).toISOString(), now, 15)).toBe(true)
  })

  it('false for null/invalid timestamps (never fail on a guess)', () => {
    expect(jobAgeExceeded(null, now, 15)).toBe(false)
    expect(jobAgeExceeded(undefined, now, 15)).toBe(false)
    expect(jobAgeExceeded('not-a-date', now, 15)).toBe(false)
  })
})

describe('cancelJob', () => {
  it('cancels a running job -> 200', async () => {
    fakeDb = fakeSupabase({ pipeline_jobs: { data: { id: 'j1', status: 'running' }, error: null } })
    const r = await cancelJob(fakeEnv(), 'j1')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, cancelled: 'j1' })
  })

  it('refuses a non-running job -> 409', async () => {
    fakeDb = fakeSupabase({ pipeline_jobs: { data: { id: 'j2', status: 'completed' }, error: null } })
    const r = await cancelJob(fakeEnv(), 'j2')
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ status_was: 'completed' })
  })

  it('404 when the job does not exist', async () => {
    fakeDb = fakeSupabase({ pipeline_jobs: { data: null, error: null } })
    const r = await cancelJob(fakeEnv(), 'missing')
    expect(r.status).toBe(404)
  })
})
