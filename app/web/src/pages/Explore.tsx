import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ChannelRow, NicheRow } from '../types'
import { channelColor, channelInitials } from '../lib/persona'
import { LiveMonitor } from '../components/LiveMonitor'
import { usePolledEffect } from '../lib/usePolling'

// Browse the seeded database the way the repo is organized — niche -> channels
// -> pick one and drive its pipeline — instead of re-uploading CSVs. Backed by
// /api/niches and /api/channels (both read straight from Supabase).
export default function Explore() {
  const [niches, setNiches] = useState<NicheRow[]>([])
  const [selectedNiche, setSelectedNiche] = useState<string>('')
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [openChannel, setOpenChannel] = useState<string>('')
  const [err, setErr] = useState('')
  const [seedMsg, setSeedMsg] = useState('')
  const [seeding, setSeeding] = useState('')

  const loadNiches = useCallback(() => {
    api.get<NicheRow[]>('/api/niches').then(setNiches).catch((e) => setErr(e.message))
  }, [])

  const loadChannels = useCallback((niche: string) => {
    const url = niche ? `/api/channels?niche=${encodeURIComponent(niche)}` : '/api/channels'
    api.get<ChannelRow[]>(url).then(setChannels).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    loadNiches()
  }, [loadNiches])

  useEffect(() => {
    if (selectedNiche) loadChannels(selectedNiche)
  }, [selectedNiche, loadChannels])

  // Poll channels of the open niche so counts advance live as the pipeline
  // runs — every 4s, paused while the tab is hidden.
  usePolledEffect(() => {
    if (selectedNiche) loadChannels(selectedNiche)
  }, 4000)

  async function seed(demo: boolean) {
    setSeeding(demo ? 'demo' : 'ref')
    setSeedMsg('')
    setErr('')
    try {
      const r = await api.post<any>(`/api/dev/seed${demo ? '?demo=1' : ''}`)
      setSeedMsg(
        demo
          ? `Loaded ${r.niches} niches + ${r.channels} channels, and a demo channel (${r.demo?.channel_id}) with ${r.demo?.transcripts} sample transcripts ready to embed.`
          : `Loaded ${r.niches} niches + ${r.channels} channels from the repo.`,
      )
      loadNiches()
      if (selectedNiche) loadChannels(selectedNiche)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSeeding('')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Explore</h1>
          <p className="page-sub">Browse the database by niche → channel and drive each channel's pipeline.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" disabled={!!seeding} onClick={() => seed(false)} type="button">
            {seeding === 'ref' ? 'Loading…' : 'Load repo data'}
          </button>
          <button className="btn-primary btn-sm" disabled={!!seeding} onClick={() => seed(true)} type="button">
            {seeding === 'demo' ? 'Loading…' : 'Load repo + demo channel'}
          </button>
        </div>
      </div>

      {seedMsg && (
        <div className="rounded-md border border-success bg-success-soft px-4 py-3 text-sm text-success">{seedMsg}</div>
      )}
      {err && (
        <div className="rounded-md border border-error bg-error-soft px-4 py-3 text-sm text-error" role="alert">
          {err}
        </div>
      )}

      <LiveMonitor />

      {niches.length === 0 ? (
        <div className="card text-sm text-muted">
          No niches loaded yet. Click <strong className="text-ink">Load repo data</strong> above to import the repo's
          100 niches + channels — no CSV upload needed.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* Niche list */}
          <aside className="rounded-md border border-edge bg-surface shadow-sm">
            <div className="eyebrow border-b border-edge px-3 py-2.5">{niches.length} niches</div>
            <ul className="max-h-[560px] overflow-y-auto">
              {niches.map((n) => (
                <li key={n.niche_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNiche(n.niche_id)
                      setOpenChannel('')
                    }}
                    className={`flex w-full items-center justify-between gap-2 border-b border-edge px-3 py-2.5 text-left transition-colors hover:bg-surface-2 ${
                      selectedNiche === n.niche_id ? 'bg-accent-soft' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{n.niche}</span>
                      <span className="block truncate font-mono text-[11px] text-muted">
                        {n.niche_id} · {n.domain}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{n.channel_count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Channels of selected niche */}
          <div className="min-w-0">
            {!selectedNiche ? (
              <div className="card text-sm text-muted">Select a niche on the left to see its channels.</div>
            ) : channels.length === 0 ? (
              <div className="card text-sm text-muted">No channels imported for {selectedNiche} yet.</div>
            ) : (
              <div className="space-y-2.5">
                {channels.map((c) => (
                  <ChannelCard
                    key={c.channel_id}
                    channel={c}
                    open={openChannel === c.channel_id}
                    onToggle={() => setOpenChannel((id) => (id === c.channel_id ? '' : c.channel_id))}
                    onChanged={() => loadChannels(selectedNiche)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ChannelCard({
  channel: c,
  open,
  onToggle,
  onChanged,
}: {
  channel: ChannelRow
  open: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)

  async function act(path: string, label: string) {
    setBusy(label)
    setMsg(null)
    try {
      const r = await api.post<any>(`/api/channels/${encodeURIComponent(c.channel_id)}/${path}`)
      if (path === 'embed-now') {
        const errs = r.errors?.length ?? 0
        const remaining = r.remaining ?? 0
        setMsg({
          text: `Embedded ${r.processed}/${r.pending_seen} transcripts into ${r.chunks} chunks${
            remaining ? ` · ${remaining} left (click again or wait for the cron)` : ''
          }${errs ? ` · ${errs} failed: ${r.errors[0]?.message ?? ''}` : ''}`,
          tone: errs && r.processed === 0 ? 'err' : 'ok',
        })
      } else if (path === 'build-persona') {
        setMsg(r.ok ? { text: 'Persona built — open Chat.', tone: 'ok' } : { text: r.error, tone: 'err' })
      } else {
        setMsg({ text: r.note || 'Started.', tone: 'ok' })
      }
      setTimeout(onChanged, 1200)
    } catch (e: any) {
      setMsg({ text: e.message, tone: 'err' })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-md border border-edge bg-surface shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60"
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-[15px] font-medium text-white"
          style={{ background: channelColor(c.channel_id) }}
          aria-hidden
        >
          {channelInitials(c.channel_name, c.channel_id)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold leading-tight text-ink">{c.channel_name}</span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">
            {c.channel_id} · {(c.subscriber_count ?? 0).toLocaleString()} subs
          </span>
        </span>
        <StageStrip channel={c} />
        <span className="shrink-0 text-muted" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="border-t border-edge px-4 py-3.5">
          <div className="flex flex-wrap gap-1.5">
            <Action label="Ingest all" busy={busy} onClick={() => act('ingest-all', 'Ingesting…')} />
            <Action label="Ingest videos" busy={busy} variant="ghost" onClick={() => act('ingest-videos', 'Scraping…')} />
            <Action
              label="Ingest transcripts"
              busy={busy}
              variant="ghost"
              onClick={() => act('ingest-transcripts', 'Transcribing…')}
            />
            <Action
              label="Embed now"
              busy={busy}
              disabled={c.transcript_count === 0}
              onClick={() => act('embed-now', 'Embedding…')}
            />
            <Action
              label="Build persona"
              busy={busy}
              disabled={c.chunk_count === 0}
              onClick={() => act('build-persona', 'Building…')}
            />
            {c.persona_status === 'active' && (
              <Link to={`/chat/${c.channel_id}`} className="btn-primary btn-sm">
                Chat →
              </Link>
            )}
          </div>

          {msg && (
            <p className={`mt-2.5 text-sm ${msg.tone === 'err' ? 'text-error' : 'text-success'}`} aria-live="polite">
              {msg.text}
            </p>
          )}

          <div className="mt-4">
            <LiveMonitor channelId={c.channel_id} />
          </div>
        </div>
      )}
    </div>
  )
}

// Compact 4-step progress: videos -> transcripts -> chunks -> persona.
function StageStrip({ channel: c }: { channel: ChannelRow }) {
  const steps: { label: string; value: number | string; done: boolean }[] = [
    { label: 'vid', value: c.video_count, done: c.video_count > 0 },
    { label: 'txt', value: c.transcript_count, done: c.transcript_count > 0 },
    { label: 'emb', value: c.chunk_count, done: c.chunk_count > 0 },
    { label: 'persona', value: c.persona_status === 'active' ? '✓' : '—', done: c.persona_status === 'active' },
  ]
  return (
    <span className="hidden shrink-0 items-center gap-1 sm:flex">
      {steps.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1">
          <span
            className={`flex flex-col items-center rounded-sm px-1.5 py-0.5 ${
              s.done ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'
            }`}
          >
            <span className="font-mono text-[12px] font-semibold tabular-nums leading-none">{s.value}</span>
            <span className="font-mono text-[8px] uppercase tracking-eyebrow">{s.label}</span>
          </span>
          {i < steps.length - 1 && <span className="text-edge-strong" aria-hidden>›</span>}
        </span>
      ))}
    </span>
  )
}

function Action({
  label,
  busy,
  onClick,
  disabled,
  variant = 'secondary',
}: {
  label: string
  busy: string
  onClick: () => void
  disabled?: boolean
  variant?: 'secondary' | 'ghost'
}) {
  const isBusy = busy === `${label}…` || busy.startsWith(label.split(' ')[0])
  return (
    <button
      type="button"
      className={`${variant === 'ghost' ? 'btn-ghost' : 'btn-secondary'} btn-sm`}
      disabled={!!busy || disabled}
      onClick={onClick}
    >
      {isBusy && busy ? busy : label}
    </button>
  )
}
