import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Stats } from '../types'
import { LiveMonitor } from '../components/LiveMonitor'
import { PipelineBoard } from '../components/PipelineBoard'
import { usePolledEffect } from '../lib/usePolling'

interface Job {
  id: string
  channel_id: string | null
  job_type: string
  status: string
  output_stats: Record<string, any> | null
  error_message: string | null
  created_at: string
}

interface CronRun {
  job_type: string
  status: string
  output_stats: Record<string, any> | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
}

interface CronHealth {
  crons: Record<string, CronRun | null>
  queues: {
    transcripts: { pending: number; processing: number; failed: number }
    videos: { pending: number; failed: number }
  }
  now: string
}

const STAT_CARDS: [keyof Stats, string][] = [
  ['niches', 'Niches'],
  ['channels', 'Channels'],
  ['active_channels', 'Active'],
  ['videos', 'Videos'],
  ['transcripts', 'Transcripts'],
  ['chunks', 'Chunks indexed'],
  ['personas', 'Personas'],
]

const STEPS: [string, string][] = [
  ['Load data', 'On Explore, click "Load repo + demo channel" — seeds the repo niches/channels plus a demo channel with sample transcripts. No CSV upload.'],
  ['Pick a channel', 'Browse niche → channel on Explore. For the demo channel, transcripts are already in; click "Embed now" to chunk + embed instantly.'],
  ['Build persona', 'Once a channel has chunks, click "Build persona" to analyze its voice.'],
  ['Chat', 'Open the persona and talk to the digital duplicate.'],
]

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [health, setHealth] = useState<CronHealth | null>(null)
  const [err, setErr] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  function load() {
    setRefreshing(true)
    Promise.all([
      api.get<Stats>('/api/stats'),
      api.get<Job[]>('/api/jobs').catch(() => []),
      api.get<CronHealth>('/api/cron-health').catch(() => null),
    ])
      .then(([s, j, h]) => {
        setStats(s)
        setJobs(Array.isArray(j) ? j : [])
        setHealth(h)
        setErr('')
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setRefreshing(false))
  }

  // Polls every 15s, paused while the tab is hidden.
  usePolledEffect(load, 15000)

  const subtitle = useMemo(() => {
    if (!stats) return 'Loading workspace…'
    const active = stats.personas
    const running = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length
    const parts = [`${stats.channels} channels imported`, `${active} persona${active === 1 ? '' : 's'} active`]
    if (running) parts.push(`${running} pipeline job${running === 1 ? '' : 's'} running`)
    return parts.join(' · ')
  }, [stats, jobs])

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={load} disabled={refreshing} type="button">
            {refreshing ? 'Refreshing…' : '⟲ Refresh'}
          </button>
          <Link to="/import" className="btn-primary btn-sm">
            + New channel
          </Link>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error bg-error-soft px-4 py-3 text-sm text-error" role="alert">
          {err}
        </div>
      )}

      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7"
        aria-live="polite"
        aria-label="Pipeline statistics"
      >
        {STAT_CARDS.map(([key, label]) => (
          <div key={key} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value">{stats ? stats[key].toLocaleString() : '—'}</div>
          </div>
        ))}
      </div>

      <PipelineBoard />

      <LiveMonitor />

      <CronHealthStrip health={health} />


      {jobs.length > 0 ? (
        <section className="card">
          <h2 className="mb-4 font-display text-lg font-medium tracking-tighter text-ink">Recent activity</h2>
          <ul className="flex flex-col">
            {jobs.slice(0, 8).map((j) => (
              <ActivityRow key={j.id} job={j} />
            ))}
          </ul>
        </section>
      ) : (
        <section className="card">
          <h2 className="mb-4 font-display text-lg font-medium tracking-tighter text-ink">How it works</h2>
          <ol className="space-y-3.5">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-white"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-semibold text-ink">{title}</div>
                  <div className="text-sm text-muted">{body}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex gap-2">
            <Link to="/explore" className="btn-primary btn-sm">
              Go to Explore
            </Link>
            <Link to="/import" className="btn-ghost btn-sm">
              Import CSV
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}

function ActivityRow({ job }: { job: Job }) {
  const pillClass = statusToPill(job.status)
  return (
    <li className="grid grid-cols-[88px_1fr_auto] items-center gap-3 border-t border-edge py-2.5 text-sm first:border-t-0">
      <span className="font-mono text-[11px] text-muted">{relativeTime(job.created_at)}</span>
      <span className="text-ink-2">
        <strong className="font-semibold text-ink">{job.channel_id ?? 'pipeline'}</strong>
        <span className="text-muted"> · {humanJob(job.job_type)}</span>
        {job.error_message && <span className="ml-1 text-error"> — {truncate(job.error_message, 60)}</span>}
      </span>
      <span className={pillClass}>
        <span className="dot" />
        {humanStatus(job.status)}
      </span>
    </li>
  )
}

function statusToPill(status: string): string {
  switch (status) {
    case 'completed':
      return 'pill-success'
    case 'running':
    case 'pending':
      return 'pill-info'
    case 'failed':
      return 'pill-error'
    default:
      return 'pill-neutral'
  }
}

function humanStatus(s: string): string {
  if (s === 'pending') return 'Queued'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function humanJob(t: string): string {
  return t.replace(/_/g, ' ')
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return `${d} d ago`
}

function CronHealthStrip({ health }: { health: CronHealth | null }) {
  if (!health) return null
  const embed = health.crons.cron_embed_drain
  const poll = health.crons.cron_apify_poll
  const tq = health.queues.transcripts
  const vq = health.queues.videos

  return (
    <section className="card" aria-label="Pipeline health">
      <h2 className="mb-3 font-display text-lg font-medium tracking-tighter text-ink">Pipeline health</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <CronRowDisplay
          title="Embedding drain"
          subtitle="Workers AI · every 2 min"
          run={embed}
          extra={`${tq.pending} pending · ${tq.processing} processing · ${tq.failed} failed`}
          extraTone={tq.failed > 0 ? 'error' : tq.pending > 0 ? 'info' : 'muted'}
        />
        <CronRowDisplay
          title="Apify poll"
          subtitle="checks running scrapes · every 2 min"
          run={poll}
          extra={`${vq.pending} videos pending · ${vq.failed} failed`}
          extraTone={vq.failed > 0 ? 'error' : vq.pending > 0 ? 'info' : 'muted'}
        />
      </div>
      {(embed?.error_message || poll?.error_message) && (
        <p className="mt-3 text-xs text-muted">
          Errors above are usually transient — try clicking Refresh in 2 min. Persistent errors mean an upstream service
          is down or quota is exhausted.
        </p>
      )}
    </section>
  )
}

function CronRowDisplay({
  title,
  subtitle,
  run,
  extra,
  extraTone,
}: {
  title: string
  subtitle: string
  run: CronRun | null | undefined
  extra: string
  extraTone: 'muted' | 'info' | 'error'
}) {
  const pill = run ? (run.status === 'failed' ? 'pill-error' : 'pill-success') : 'pill-neutral'
  const label = run ? (run.status === 'failed' ? 'Failing' : 'OK') : 'No data yet'
  const lastRun = run?.completed_at ? relativeTime(run.completed_at) : '—'
  const extraColor =
    extraTone === 'error' ? 'text-error' : extraTone === 'info' ? 'text-info' : 'text-muted'

  return (
    <div className="rounded-md border border-edge bg-surface-2 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{title}</div>
          <div className="text-xs text-muted">{subtitle}</div>
        </div>
        <span className={pill}>
          <span className="dot" />
          {label}
        </span>
      </div>
      <div className="mt-2 font-mono text-[11px] text-muted">Last tick: {lastRun}</div>
      <div className={`mt-1 font-mono text-[11px] ${extraColor}`}>{extra}</div>
      {run?.error_message && (
        <div className="mt-2 rounded-sm bg-error-soft px-2 py-1 font-mono text-[11px] text-error">
          {truncate(run.error_message, 200)}
        </div>
      )}
    </div>
  )
}

