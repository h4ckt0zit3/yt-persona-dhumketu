import { describe, expect, it } from 'vitest'
import { AppError, fromHttpError } from '../src/lib/errors'

describe('AppError', () => {
  it('uses defaults for status when not supplied', () => {
    const e = new AppError('not_found', 'gone')
    expect(e.status).toBe(404)
    expect(e.retryable).toBe(false)
  })

  it('marks upstream/quota errors retryable by default', () => {
    expect(new AppError('apify_failed', 'x').retryable).toBe(true)
    expect(new AppError('embed_quota', 'x').retryable).toBe(true)
    expect(new AppError('embed_failed', 'x').retryable).toBe(true)
    expect(new AppError('llm_failed', 'x').retryable).toBe(true)
    expect(new AppError('upstream_unavailable', 'x').retryable).toBe(true)
  })

  it('marks auth + bad_request + not_found non-retryable', () => {
    expect(new AppError('unauthorized', 'x').retryable).toBe(false)
    expect(new AppError('forbidden', 'x').retryable).toBe(false)
    expect(new AppError('bad_request', 'x').retryable).toBe(false)
    expect(new AppError('not_found', 'x').retryable).toBe(false)
    expect(new AppError('db_failed', 'x').retryable).toBe(false)
  })

  it('honors explicit overrides', () => {
    const e = new AppError('apify_failed', 'msg', { status: 418, retryable: false })
    expect(e.status).toBe(418)
    expect(e.retryable).toBe(false)
  })

  it('toJSON shape matches API contract', () => {
    const e = new AppError('llm_failed', 'bad json', { context: { sample: 'abc' } })
    expect(e.toJSON()).toEqual({
      error: 'bad json',
      code: 'llm_failed',
      retryable: true,
      context: { sample: 'abc' },
    })
  })

  it('toJSON omits context key when no context', () => {
    const e = new AppError('not_found', 'gone')
    expect(e.toJSON()).toEqual({ error: 'gone', code: 'not_found', retryable: false })
  })

  it('preserves Error.message and instanceof Error', () => {
    const e = new AppError('apify_failed', 'kaboom')
    expect(e.message).toBe('kaboom')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(AppError)
  })

  it('captures cause when provided', () => {
    const cause = new Error('underlying')
    const e = new AppError('llm_failed', 'wrapped', { cause })
    expect((e as any).cause).toBe(cause)
  })
})

describe('fromHttpError', () => {
  it('marks 5xx and 429 retryable', () => {
    expect(fromHttpError('apify_failed', 'X', 500, '').retryable).toBe(true)
    expect(fromHttpError('apify_failed', 'X', 503, '').retryable).toBe(true)
    expect(fromHttpError('apify_failed', 'X', 429, '').retryable).toBe(true)
  })

  it('marks 4xx (non-429) non-retryable', () => {
    expect(fromHttpError('apify_failed', 'X', 404, '').retryable).toBe(false)
    expect(fromHttpError('apify_failed', 'X', 401, '').retryable).toBe(false)
  })

  it('truncates upstream body to 300 chars', () => {
    const long = 'a'.repeat(1000)
    const e = fromHttpError('apify_failed', 'X', 500, long)
    expect(e.message.length).toBeLessThanOrEqual('X error (500): '.length + 300)
  })

  it('includes upstream status in context', () => {
    const e = fromHttpError('apify_failed', 'X', 404, 'gone')
    expect(e.context).toMatchObject({ upstream_status: 404, service: 'X' })
  })

  it('maps to 502 status when upstream >= 500', () => {
    expect(fromHttpError('apify_failed', 'X', 503, '').status).toBe(502)
  })

  it('maps to 500 status when upstream is 4xx', () => {
    expect(fromHttpError('apify_failed', 'X', 404, '').status).toBe(500)
  })
})
