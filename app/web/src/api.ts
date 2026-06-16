import type { ChatMessage } from './types'
import { getAccessToken } from './lib/auth'

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const t = getAccessToken()
  return {
    ...(t ? { authorization: `Bearer ${t}` } : {}),
    ...(extra ?? {}),
  }
}

// Errors thrown by api.* carry the structured fields from AppError so the UI
// can show retry buttons, distinct copy by code, etc.
export class ApiError extends Error {
  code: string
  retryable: boolean
  status: number
  constructor(message: string, opts: { code?: string; retryable?: boolean; status?: number }) {
    super(message)
    this.name = 'ApiError'
    this.code = opts.code ?? 'unknown'
    this.retryable = opts.retryable ?? false
    this.status = opts.status ?? 0
  }
}

async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string; code?: string; retryable?: boolean }
    throw new ApiError(body.error || `${r.status} ${r.statusText}`, {
      code: body.code,
      retryable: body.retryable ?? false,
      status: r.status,
    })
  }
  return r.json() as Promise<T>
}

export const api = {
  get: <T>(url: string) => fetch(url, { headers: authHeaders() }).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: authHeaders(body ? { 'content-type': 'application/json' } : undefined),
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  postCsv: <T>(url: string, csv: string) =>
    fetch(url, {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'text/csv' }),
      body: csv,
    }).then((r) => handle<T>(r)),
}

// Streaming chat: calls onToken for each text delta as it arrives.
export async function chatStream(
  channelId: string,
  messages: ChatMessage[],
  onToken: (t: string) => void,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ channel_id: channelId, messages }),
  })
  if (!res.ok || !res.body) {
    const msg = await res.json().catch(() => ({}))
    throw new Error((msg as any).error || 'chat failed')
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onToken(dec.decode(value, { stream: true }))
  }
}
