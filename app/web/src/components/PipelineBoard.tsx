import { useState } from 'react'
import { api } from '../api'
import { usePolledEffect } from '../lib/usePolling'

// The v2 monitoring centerpiece: the 5-stage pipeline laid out left-to-right so
// you can see at a glance WHICH stage is backed up or failing. Backed by
// GET /api/pipeline (app/src/stages/monitor.ts). Reuses existing design tokens
// only — no new colors/patterns (see DESIGN.md).

interface StageHealth {
  stage: string
  title: string
  queue: number
  inflight: number
  failed: number
  lastRunAt: string | null
  lastError: string | null
  folded?: boolean
}
interface PipelineHealth {
  now: string
  stages: StageHealth[]
}

type Tone = 'ok' | 'working' | 'waiting' | 'error'

function toneOf(s: StageHealth): Tone {
  if (s.failed > 0) return 'error'
  if (s.inflight > 0) return 'working'
  if (s.queue > 0) return 'waiting'
  return 'ok'
}

const PILL: Record<Tone, string> = {
  ok: 'pill-success',
  working: 'pill-info',
  waiting: 'pill-neutral',
  error: 'pill-error',
}
const LABEL: Record<Tone, string> = { ok: 'Idle', working: 'Working', waiting: 'Queued', error: 'Failing' }

export function PipelineBoard() {
  const [data, setData] = useState<PipelineHealth | null>(null)
  const [err, setErr] = useState('')

  usePolledEffect(() => {
    api
      .get<PipelineHealth>('/api/pipeline')
      .then((d) => {
        setData(d)
        setErr('')
      })
      .catch((e: Error) => setErr(e.message))
  }, 15000)

  return (
    <section className="card" aria-label="Pipeline stages">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-medium tracking-tighter text-ink">Pipeline stages</h2>
        <span className="text-xs text-muted">fetch → transcribe → clean → chunk → embed</span>
      </div>

      {err && (
        <div className="mb-3 rounded-md border border-error bg-error-soft px-3 py-2 text-sm text-error" role="alert">
          {err}
        </div>
      )}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0" aria-live="polite">
        {(data?.stages ?? PLACEHOLDER).map((s, i) => (
          <div key={s.stage} className="flex items-stretch lg:flex-1">
            <StageTile stage={s} />
            {i < (data?.stages ?? PLACEHOLDER).length - 1 && (
              <span className="hidden select-none items-center px-1 text-muted lg:flex" aria-hidden>
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function StageTile({ stage }: { stage: StageHealth }) {
  const tone = toneOf(stage)
  return (
    <div className="flex w-full flex-col rounded-md border border-edge bg-surface-2 px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{stage.title}</div>
          {stage.folded && <div className="text-[10px] text-muted">shares embed backlog</div>}
        </div>
        <span className={PILL[tone]}>
          <span className="dot" />
          {LABEL[tone]}
        </span>
      </div>

      <div className="mt-2 flex gap-3 font-mono text-[11px]">
        <Counter label="queue" value={stage.queue} tone={stage.queue > 0 ? 'info' : 'muted'} />
        <Counter label="working" value={stage.inflight} tone={stage.inflight > 0 ? 'info' : 'muted'} />
        <Counter label="failed" value={stage.failed} tone={stage.failed > 0 ? 'error' : 'muted'} />
      </div>

      <div className="mt-1.5 font-mono text-[10px] text-muted">{lastRun(stage.lastRunAt)}</div>

      {stage.lastError && (
        <div className="mt-2 rounded-sm bg-error-soft px-2 py-1 font-mono text-[10px] text-error">
          {truncate(stage.lastError, 90)}
        </div>
      )}
    </div>
  )
}

function Counter({ label, value, tone }: { label: string; value: number; tone: 'muted' | 'info' | 'error' }) {
  const color = tone === 'error' ? 'text-error' : tone === 'info' ? 'text-info' : 'text-muted'
  return (
    <span className={color}>
      <span className="font-semibold">{value}</span> {label}
    </span>
  )
}

const PLACEHOLDER: StageHealth[] = [
  'Fetch videos',
  'Transcribe & save',
  'Clean',
  'Chunk',
  'Embed',
].map((title, i) => ({
  stage: String(i),
  title,
  queue: 0,
  inflight: 0,
  failed: 0,
  lastRunAt: null,
  lastError: null,
}))

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function lastRun(iso: string | null): string {
  if (!iso) return 'no runs yet'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `ran ${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `ran ${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `ran ${h} hr ago` : `ran ${Math.round(h / 24)} d ago`
}
