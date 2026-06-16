import { describe, expect, it, vi } from 'vitest'
import { embedTexts } from '../src/lib/embed'
import { AppError } from '../src/lib/errors'
import { fakeEnv, mockFetchOnce } from './helpers'

describe('embedTexts — Workers AI provider', () => {
  it('returns vectors from env.AI.run on success', async () => {
    const env = fakeEnv()
    ;(env.AI.run as any).mockResolvedValueOnce({ data: [[0.1, 0.2], [0.3, 0.4]] })
    const out = await embedTexts(env, ['hello', 'world'])
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]])
    expect(env.AI.run).toHaveBeenCalledWith('@cf/baai/bge-large-en-v1.5', { text: ['hello', 'world'] })
  })

  it('wraps Workers AI throws as AppError code=embed_failed', async () => {
    const env = fakeEnv()
    ;(env.AI.run as any).mockRejectedValueOnce(new Error('model not available'))
    await expect(embedTexts(env, ['x'])).rejects.toBeInstanceOf(AppError)
    try {
      await embedTexts(env, ['x'])
    } catch (e: any) {
      expect(e.code).toBe('embed_failed')
      expect(e.retryable).toBe(true)
    }
  })

  it('marks Workers AI quota errors as embed_quota', async () => {
    const env = fakeEnv()
    ;(env.AI.run as any).mockRejectedValueOnce(new Error('quota exceeded for today'))
    try {
      await embedTexts(env, ['x'])
    } catch (e: any) {
      expect(e.code).toBe('embed_quota')
      expect(e.retryable).toBe(true)
    }
  })

  it('detects rate limit messages', async () => {
    const env = fakeEnv()
    ;(env.AI.run as any).mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
    try {
      await embedTexts(env, ['x'])
    } catch (e: any) {
      expect(e.code).toBe('embed_quota')
    }
  })
})

describe('embedTexts — OpenAI provider', () => {
  it('returns vectors from OpenAI on success', async () => {
    mockFetchOnce({ data: [{ embedding: [0.5, 0.6] }, { embedding: [0.7, 0.8] }] })
    const env = fakeEnv({ EMBED_PROVIDER: 'openai' })
    const out = await embedTexts(env, ['a', 'b'])
    expect(out).toEqual([[0.5, 0.6], [0.7, 0.8]])
  })

  it('wraps OpenAI 429 as embed_quota', async () => {
    mockFetchOnce({ error: { message: 'too many requests' } }, { status: 429 })
    const env = fakeEnv({ EMBED_PROVIDER: 'openai' })
    try {
      await embedTexts(env, ['a'])
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError)
      expect(e.code).toBe('embed_quota')
      expect(e.retryable).toBe(true)
    }
  })

  it('wraps non-429 OpenAI failures as embed_failed', async () => {
    mockFetchOnce({ error: { message: 'bad request' } }, { status: 400 })
    const env = fakeEnv({ EMBED_PROVIDER: 'openai' })
    try {
      await embedTexts(env, ['a'])
    } catch (e: any) {
      expect(e.code).toBe('embed_failed')
    }
  })

  it('sends model + input in the request body', async () => {
    const spy = mockFetchOnce({ data: [{ embedding: [1] }] })
    const env = fakeEnv({ EMBED_PROVIDER: 'openai' })
    await embedTexts(env, ['hi'])
    const call = spy.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body).toMatchObject({ model: 'text-embedding-3-small', input: ['hi'] })
  })
})
