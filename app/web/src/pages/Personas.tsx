import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Persona } from '../types'
import { channelColor, channelInitials } from '../lib/persona'

export default function Personas() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    api.get<Persona[]>('/api/personas').then(setPersonas).catch((e) => setErr(e.message))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Personas</h1>
          <p className="page-sub">
            {personas.length} {personas.length === 1 ? 'active persona' : 'active personas'} · click any card to chat
          </p>
        </div>
        <Link to="/channels" className="btn-ghost btn-sm">
          ← Channels
        </Link>
      </div>

      {err && (
        <div className="rounded-md border border-error bg-error-soft px-4 py-3 text-sm text-error" role="alert">
          {err}
        </div>
      )}

      {personas.length === 0 ? (
        <div className="card text-sm text-muted">
          No active personas yet. Ingest a channel and click "Build persona" on the{' '}
          <Link to="/channels" className="font-medium text-accent hover:underline">
            Channels
          </Link>{' '}
          tab.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map((p) => {
            const stats = (p.knowledge_stats as any) || {}
            const color = channelColor(p.channel_id)
            return (
              <Link
                key={p.channel_id}
                to={`/chat/${p.channel_id}`}
                className="group relative flex flex-col gap-3 overflow-hidden rounded-md border border-edge bg-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: color }}
                  aria-hidden
                />
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-full font-display text-lg font-medium text-white"
                    style={{ background: color }}
                    aria-hidden
                  >
                    {channelInitials(p.persona_name, p.channel_id)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg font-medium tracking-tighter text-ink">
                      {p.persona_name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted">
                      {p.channel_id}
                      {p.niche_id ? ` · ${p.niche_id}` : ''}
                    </div>
                  </div>
                </div>
                {p.description && (
                  <p className="line-clamp-3 text-sm text-ink-2">{p.description}</p>
                )}
                <div className="mt-auto flex items-center justify-between border-t border-edge pt-3">
                  <div className="font-mono text-[11px] text-muted">
                    {(stats.total_videos_processed ?? 0).toLocaleString()} videos ·{' '}
                    {(stats.total_chunks ?? 0).toLocaleString()} chunks
                  </div>
                  <span className="text-xs font-medium text-accent transition-colors group-hover:text-accent-hover">
                    Chat →
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
