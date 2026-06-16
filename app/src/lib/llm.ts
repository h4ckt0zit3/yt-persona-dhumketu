import type { Env, ChatMessage } from '../types'
import { fromHttpError } from './errors'

// Provider-agnostic chat. Anthropic (with prompt caching on the stable
// persona system prompt) or OpenAI-compatible. The OpenAI branch honors
// OPENAI_BASE_URL, so it also drives OpenRouter, Groq, Together, or any
// other OpenAI-API-compatible endpoint.

interface ChatOpts {
  system: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
}

export function streamChat(env: Env, opts: ChatOpts): Promise<ReadableStream<Uint8Array>> {
  return env.LLM_PROVIDER === 'openai' ? streamOpenAI(env, opts) : streamAnthropic(env, opts)
}

export async function completeChat(env: Env, opts: ChatOpts): Promise<string> {
  if (env.LLM_PROVIDER === 'openai') return completeOpenAI(env, opts)
  return completeAnthropic(env, opts)
}

// ---- Anthropic ----------------------------------------------------------

function anthropicBody(env: Env, opts: ChatOpts, stream: boolean) {
  return {
    model: env.CHAT_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    stream,
    // System as a cacheable block — persona prompt is stable across turns.
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  }
}

async function callAnthropic(env: Env, body: unknown): Promise<Response> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw fromHttpError('llm_failed', 'Anthropic', res.status, await res.text())
  return res
}

async function streamAnthropic(env: Env, opts: ChatOpts): Promise<ReadableStream<Uint8Array>> {
  const res = await callAnthropic(env, anthropicBody(env, opts, true))
  return parseSSE(res.body!, (evt) => {
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      return evt.delta.text as string
    }
    return null
  })
}

async function completeAnthropic(env: Env, opts: ChatOpts): Promise<string> {
  const res = await callAnthropic(env, anthropicBody(env, opts, false))
  const json = (await res.json()) as { content: { type: string; text: string }[] }
  return json.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

// ---- OpenAI -------------------------------------------------------------

function openAIBody(env: Env, opts: ChatOpts, stream: boolean) {
  return {
    model: env.CHAT_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    stream,
    messages: [{ role: 'system', content: opts.system }, ...opts.messages],
  }
}

async function callOpenAI(env: Env, body: unknown): Promise<Response> {
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw fromHttpError('llm_failed', 'OpenAI', res.status, await res.text())
  return res
}

async function streamOpenAI(env: Env, opts: ChatOpts): Promise<ReadableStream<Uint8Array>> {
  const res = await callOpenAI(env, openAIBody(env, opts, true))
  return parseSSE(res.body!, (evt) => evt.choices?.[0]?.delta?.content ?? null)
}

async function completeOpenAI(env: Env, opts: ChatOpts): Promise<string> {
  const res = await callOpenAI(env, openAIBody(env, opts, false))
  const json = (await res.json()) as { choices: { message: { content: string } }[] }
  return json.choices[0]?.message?.content ?? ''
}

// ---- Shared SSE -> plain-text stream transform --------------------------

function parseSSE(
  body: ReadableStream<Uint8Array>,
  extract: (evt: any) => string | null,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  // Process one SSE line. Returns true if the [DONE] sentinel was seen so the
  // caller closes the stream.
  function emitLine(line: string, controller: ReadableStreamDefaultController<Uint8Array>): boolean {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') return true
    try {
      const evt = JSON.parse(data)
      const text = extract(evt)
      if (text) controller.enqueue(encoder.encode(text))
    } catch {
      // ignore keep-alive / non-JSON lines
    }
    return false
  }

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        // Flush a trailing line not terminated by a newline before close, so a
        // final token isn't lost if the upstream ends without a newline/[DONE].
        if (buffer.trim()) emitLine(buffer, controller)
        buffer = ''
        controller.close()
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (emitLine(line, controller)) {
          controller.close()
          return
        }
      }
    },
    cancel() {
      reader.cancel()
    },
  })
}
