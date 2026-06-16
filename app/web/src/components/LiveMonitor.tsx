import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { usePolledEffect } from '../lib/usePolling'
import type { Activity } from '../types'

// A job running longer than this is treated as stuck (matches the worker's
// MAX_JOB_AGE_MIN default) — shown amber with a Resolve button, not as "live".
const STUCK_MIN = 15

// Polls /api/activity (paused while the tab is hidden) and renders what the
// backend is actually doing: a 3-stage flow (scrape -> transcribe -> embed) that
// animates only while a stage has in-flight work, running jobs with elapsed
// time, and the cron heartbeat. Pass `channelId` to scope it to one channel.
export function useActivity(intervalMs = 5000) {
  const [activity, setActivity] = useState<Activity | null>(null)
  const [error, setError] = useState('')
  const [lastAt, setLastAt] = useState<number>(0)

  const load = useCallback(
    () =>
      api
        .get<Activity>('/api/activity')
        .then((a) => {
          setActivity(a)
          setLastAt(Date.now())
          setError('')
        })
        .catch((e) => setError((e as Error).message)),
    [],
  )

  usePolledEffect(() => {
    load()
  }, intervalMs)

  return { activity, error, lastAt, refetch: load }
}

function secondsAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
}

function ago(iso: string | null | undefined): string {
  const s = secondsAgo(iso)
  if (s === null) return '—'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)} hr ago`
}

function elapsed(iso: string | null): string {
  const s = secondsAgo(iso)
  if (s === null) return ''
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

export function LiveMonitor({ channelId, lastAtOverride }: { channelId?: string; lastAtOverride?: number }) {
  const { activity, error, lastAt, refetch } = useActivity()
  const [resolving, setResolving] = useState('')

  async function resolveJob(id: string) {
    setResolving(id)
    try {
      await api.post(`/api/jobs/${encodeURIComponent(id)}/cancel`)
      await refetch()
    } catch {
      /* surfaced on next poll */
    } finally {
      setResolving('')
    }
  }

  if (error && !activity) {
    return (
      <section className="card" aria-label="Backend activity">
        <Header live={false} lastAt={0} />
        <p className="mt-3 text-sm text-error">Couldn't reach the backend: {error}</p>
      </section>
    )
  }
  if (!activity) {
    return (
      <section className="card" aria-label="Backend activity">
        <Header live={false} lastAt={0} loading />
      </section>
    )
  }

  const jobs = channelId
    ? activity.running_jobs.filter((j) => j.channel_id === channelId)
    : activity.running_jobs

  const scrapeJobs = jobs.filter((j) => j.job_type === 'video_extraction')
  const transcriptJobs = jobs.filter((j) => j.job_type === 'transcript_extraction')

  const transcribing = channelId
    ? activity.stages.transcribing.by_channel[channelId] ?? 0
    : activity.stages.transcribing.count
  const embedding = channelId
    ? activity.stages.embedding.by_channel[channelId] ?? 0
    : activity.stages.embedding.count

  // Queues are global-only (cheap counts); hide the queued number when scoped.
  const q = activity.queues
  const stages = [
    {
      key: 'scrape',
      label: 'Scrape videos',
      working: scrapeJobs.length,
      queued: null as number | null,
      active: scrapeJobs.length > 0,
    },
    {
      key: 'transcribe',
      label: 'Transcribe',
      working: transcribing + transcriptJobs.length,
      queued: channelId ? null : q.videos_pending,
      active: transcribing > 0 || transcriptJobs.length > 0,
    },
    {
      key: 'embed',
      label: 'Clean + embed',
      working: embedding,
      queued: channelId ? null : q.transcripts_pending,
      active: embedding > 0,
    },
  ]

  const isStuck = (startedAt: string | null) => (secondsAgo(startedAt) ?? 0) > STUCK_MIN * 60
  const freshJobs = jobs.filter((j) => !isStuck(j.started_at))
  const stuckJobs = jobs.filter((j) => isStuck(j.started_at))
  const anyActive = stages.some((s) => s.active) || freshJobs.length > 0
  const embedTick = secondsAgo(activity.cron.embed_drain?.completed_at)
  const apifyTick = secondsAgo(activity.cron.apify_poll?.completed_at)
  const cronAlive = (embedTick !== null && embedTick < 300) || (apifyTick !== null && apifyTick < 300)

  return (
    <section className="card" aria-label="Backend activity">
      <Header live={anyActive} cronAlive={cronAlive} lastAt={lastAtOverride ?? lastAt} />

      {/* Stage flow — animates only where work is in flight */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch">
        {stages.map((s, i) => (
          <Stage key={s.key} stage={s} arrow={i < stages.length - 1} />
        ))}
      </div>

      {/* Honest empty state — the whole point is to never wonder "is it doing anything?" */}
      {!anyActive && stuckJobs.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          Backend is idle — nothing is processing right now.
          {!channelId && (q.transcripts_failed > 0 ? ` ${q.transcripts_failed} transcript(s) failed.` : '')}
        </p>
      )}

      {/* Active jobs — live elapsed time, animated flow bar */}
      {freshJobs.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {freshJobs.map((j) => (
            <li
              key={j.id}
              className="flex items-center gap-3 rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="text-info" aria-hidden>
                <span className="live-dot inline-block" />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="font-semibold text-ink">{j.channel_id ?? 'pipeline'}</strong>
                <span className="text-muted"> · {j.job_type.replace(/_/g, ' ')}</span>
              </span>
              <span className="flow-track w-24 shrink-0">
                <span className="flow-bar" />
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{elapsed(j.started_at)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Stuck jobs — running past the budget. Amber, no animation, Resolve button. */}
      {stuckJobs.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {stuckJobs.map((j) => (
            <li
              key={j.id}
              className="flex items-center gap-3 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm"
            >
              <span className="text-warning" aria-hidden>
                ⚠
              </span>
              <span className="min-w-0 flex-1">
                <strong className="font-semibold text-ink">{j.channel_id ?? 'pipeline'}</strong>
                <span className="text-muted"> · {j.job_type.replace(/_/g, ' ')} · stuck {elapsed(j.started_at)}</span>
              </span>
              <button
                type="button"
                onClick={() => resolveJob(j.id)}
                disabled={resolving === j.id}
                className="shrink-0 rounded-sm border border-warning px-2 py-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning hover:text-white disabled:opacity-50"
              >
                {resolving === j.id ? 'Resolving…' : 'Resolve'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Cron heartbeat */}
      {!channelId && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-edge pt-3 font-mono text-[11px] text-muted">
          <Heartbeat label="Embed drain" tick={embedTick} run={activity.cron.embed_drain} agoStr={ago(activity.cron.embed_drain?.completed_at)} />
          <Heartbeat label="Apify poll" tick={apifyTick} run={activity.cron.apify_poll} agoStr={ago(activity.cron.apify_poll?.completed_at)} />
        </div>
      )}
    </section>
  )
}

function Header({
  live,
  cronAlive,
  lastAt,
  loading,
}: {
  live: boolean
  cronAlive?: boolean
  lastAt: number
  loading?: boolean
}) {
  const tone = live ? 'text-info' : cronAlive ? 'text-success' : 'text-muted'
  const label = loading ? 'Connecting…' : live ? 'Processing' : cronAlive ? 'Idle · backend healthy' : 'Idle'
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-display text-lg font-medium tracking-tighter text-ink">Backend activity</h2>
      <span className={`inline-flex items-center gap-2 text-[11px] font-medium ${tone}`}>
        <span className={live ? 'live-dot' : 'h-2 w-2 rounded-full bg-current'} />
        {label}
        {lastAt > 0 && <LiveClock lastAt={lastAt} />}
      </span>
    </div>
  )
}

// Ticks every second so "updated Xs ago" actually moves between polls.
function LiveClock({ lastAt }: { lastAt: number }) {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((Date.now() - lastAt) / 1000))
  return <span className="font-mono text-muted">· {s}s ago</span>
}

function Stage({
  stage,
  arrow,
}: {
  stage: { label: string; working: number; queued: number | null; active: boolean }
  arrow: boolean
}) {
  return (
    <>
      <div
        className={`rounded-md border px-3 py-2.5 ${
          stage.active ? 'border-accent bg-accent-soft' : 'border-edge bg-surface-2'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink">{stage.label}</span>
          <span className={`font-mono text-[11px] tabular-nums ${stage.active ? 'text-accent' : 'text-muted'}`}>
            {stage.working > 0 ? `${stage.working} live` : 'idle'}
          </span>
        </div>
        <div className="mt-2 flow-track">{stage.active ? <span className="flow-bar" /> : <span className="flow-bar-idle" />}</div>
        {stage.queued !== null && (
          <div className="mt-1.5 font-mono text-[10px] text-muted">{stage.queued} queued</div>
        )}
      </div>
      {arrow && (
        <div className="hidden items-center justify-center text-edge-strong sm:flex" aria-hidden>
          →
        </div>
      )}
    </>
  )
}

function Heartbeat({
  label,
  tick,
  agoStr,
  run,
}: {
  label: string
  tick: number | null
  agoStr: string
  run: { status: string; error_message: string | null } | null
}) {
  const stale = tick === null || tick > 300
  const failed = run?.status === 'failed'
  const color = failed ? 'text-error' : stale ? 'text-warning' : 'text-success'
  const mark = failed ? '✕' : stale ? '○' : '✓'
  return (
    <span className={color} title={run?.error_message ?? ''}>
      {mark} {label}: {agoStr}
      {stale && !failed ? ' (stale)' : ''}
    </span>
  )
}
