import { describe, expect, it, vi } from 'vitest'
import { streamChat, completeChat } from '../src/lib/llm'
import { AppError } from '../src/lib/errors'
import { fakeEnv, mockFetchOnce } from './helpers'

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('completeChat (Anthropic branch)', () => {
  it('extracts text from Anthropic non-streaming response', async () => {
    mockFetchOnce({
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
      ],
    })
    const env = fakeEnv({ LLM_PROVIDER: 'anthropic', CHAT_MODEL: 'claude-sonnet-4-6' })
    const out = await completeChat(env, { system: 'sys', messages: [{ role: 'user', content: 'hi' }] })
    expect(out).toBe('Hello world')
  })

  it('throws AppError code=llm_failed on non-200', async () => {
    mockFetchOnce('bad', { status: 500 })
    const env = fakeEnv({ LLM_PROVIDER: 'anthropic' })
    await expect(
      completeChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(AppError)
  })
})

describe('completeChat (OpenAI/OpenRouter branch)', () => {
  it('extracts content from OpenAI non-streaming response', async () => {
    mockFetchOnce({ choices: [{ message: { content: 'Hi there' } }] })
    const env = fakeEnv({ LLM_PROVIDER: 'openai' })
    const out = await completeChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] })
    expect(out).toBe('Hi there')
  })

  it('honors OPENAI_BASE_URL (OpenRouter routing)', async () => {
    const spy = mockFetchOnce({ choices: [{ message: { content: 'x' } }] })
    const env = fakeEnv({ LLM_PROVIDER: 'openai', OPENAI_BASE_URL: 'https://openrouter.ai/api/v1' })
    await completeChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] })
    expect(spy.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('falls back to api.openai.com when OPENAI_BASE_URL is unset', async () => {
    const spy = mockFetchOnce({ choices: [{ message: { content: 'x' } }] })
    const env = fakeEnv({ LLM_PROVIDER: 'openai', OPENAI_BASE_URL: undefined })
    await completeChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] })
    expect(spy.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('throws AppError llm_failed on non-200', async () => {
    mockFetchOnce({ error: 'bad' }, { status: 400 })
    const env = fakeEnv({ LLM_PROVIDER: 'openai' })
    await expect(
      completeChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('returns empty string when no content present (defensive)', async () => {
    mockFetchOnce({ choices: [] })
    const env = fakeEnv({ LLM_PROVIDER: 'openai' })
    const out = await completeChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] })
    expect(out).toBe('')
  })
})

describe('streamChat — SSE parsing', () => {
  it('extracts text deltas from Anthropic SSE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        sseResponse([
          JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } }),
          JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } }),
          JSON.stringify({ type: 'message_stop' }),
        ]),
      ),
    )
    const env = fakeEnv({ LLM_PROVIDER: 'anthropic' })
    const stream = await streamChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] })

    const reader = stream.getReader()
    const dec = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out += dec.decode(value, { stream: true })
    }
    expect(out).toBe('Hello')
  })

  it('extracts content from OpenAI SSE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        sseResponse([
          JSON.stringify({ choices: [{ delta: { content: 'Hi ' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'there' } }] }),
        ]),
      ),
    )
    const env = fakeEnv({ LLM_PROVIDER: 'openai' })
    const stream = await streamChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] })

    const reader = stream.getReader()
    const dec = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out += dec.decode(value, { stream: true })
    }
    expect(out).toBe('Hi there')
  })

  it('ignores malformed JSON lines (keep-alive comments etc.)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        sseResponse([
          'not-json',
          JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }),
        ]),
      ),
    )
    const env = fakeEnv({ LLM_PROVIDER: 'openai' })
    const stream = await streamChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] })
    const reader = stream.getReader()
    const dec = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out += dec.decode(value, { stream: true })
    }
    expect(out).toBe('ok')
  })

  it('closes the stream on [DONE] sentinel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n\ndata: [DONE]\n\n`,
          { status: 200 },
        ),
      ),
    )
    const env = fakeEnv({ LLM_PROVIDER: 'openai' })
    const stream = await streamChat(env, { system: 's', messages: [{ role: 'user', content: 'x' }] })
    const reader = stream.getReader()
    let chunks = 0
    for (;;) {
      const { done } = await reader.read()
      if (done) break
      chunks++
    }
    expect(chunks).toBeGreaterThanOrEqual(1)
  })
})
