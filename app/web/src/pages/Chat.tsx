import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, chatStream } from '../api'
import type { ChatMessage, Persona } from '../types'
import { channelColor, channelInitials } from '../lib/persona'

export default function Chat() {
  const { channelId = '' } = useParams()
  const [persona, setPersona] = useState<Persona | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get<Persona>(`/api/personas/${channelId}`).then(setPersona).catch((e) => setErr(e.message))
  }, [channelId])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    endRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    setErr('')
    setInput('')
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setStreaming(true)
    try {
      await chatStream(channelId, next, (token) => {
        setMessages((cur) => {
          const copy = [...cur]
          copy[copy.length - 1] = {
            role: 'assistant',
            content: copy[copy.length - 1].content + token,
          }
          return copy
        })
      })
    } catch (e: any) {
      setErr(e.message)
      setMessages((cur) => cur.slice(0, -1))
    } finally {
      setStreaming(false)
    }
  }

  const stats = (persona?.knowledge_stats as any) || {}
  const totalChunks = stats.total_chunks ?? stats.total_videos_processed ?? null

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden rounded-md border border-edge bg-surface shadow-sm">
      <header className="flex items-center gap-3.5 border-b border-edge px-5 py-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-display text-lg font-medium text-white"
          style={{ background: channelColor(channelId) }}
          aria-hidden
        >
          {channelInitials(persona?.persona_name, channelId)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-medium tracking-tighter text-ink">
            {persona?.persona_name ?? 'Persona'}
          </h1>
          <p className="truncate font-mono text-[11px] text-muted">
            {channelId}
            {persona?.niche_id ? ` · ${persona.niche_id}` : ''}
            {totalChunks != null ? ` · ${totalChunks.toLocaleString()} chunks indexed` : ''}
          </p>
        </div>
        {persona && (
          <span className="pill-success" aria-label="Grounded in source videos">
            <span className="dot" />
            Grounded
          </span>
        )}
        <Link to="/personas" className="btn-ghost btn-sm">
          All personas
        </Link>
      </header>

      {err && (
        <div className="mx-5 mt-3 rounded-md border border-error bg-error-soft px-3 py-2 text-sm text-error" role="alert">
          {err}
        </div>
      )}

      <div
        className="flex-1 space-y-4 overflow-y-auto bg-canvas px-5 py-6"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 && (
          <p className="mx-auto max-w-md text-center text-sm text-muted">
            Ask {persona?.persona_name ?? 'this creator'} anything — answers are grounded in their own videos.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-sm'
                  : 'max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-edge bg-surface px-4 py-2.5 text-[14.5px] leading-relaxed text-ink shadow-sm'
              }
            >
              {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-center gap-2 border-t border-edge bg-surface px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <input
          id="chat-input"
          name="message"
          autoComplete="off"
          className="input rounded-full"
          placeholder={`Ask ${persona?.persona_name ?? 'the creator'} anything…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
        />
        <button className="btn-primary" disabled={streaming || !input.trim()} type="submit">
          Send
        </button>
      </form>
    </div>
  )
}
