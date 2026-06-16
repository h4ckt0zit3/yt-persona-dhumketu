import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import type { ChannelRow } from '../types'
import { channelColor, channelInitials } from '../lib/persona'
import { usePolledEffect } from '../lib/usePolling'

export default function Channels() {
  const [searchParams, setSearchParams] = useSearchParams()
  const niche = searchParams.get('niche') ?? ''
  const [rows, setRows] = useState<ChannelRow[]>([])
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    const url = niche ? `/api/channels?niche=${encodeURIComponent(niche)}` : '/api/channels'
    api
      .get<ChannelRow[]>(url)
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [niche])

  // Immediate reload when the niche filter changes.
  useEffect(() => {
    load()
  }, [load])

  // Background poll every 8s, paused while the tab is hidden.
  usePolledEffect(load, 8000)

  function setNiche(value: string) {
    setSearchParams(value ? { niche: value } : {}, { replace: true })
  }

  async function act(id: string, path: string, label: string) {
    setErr('')
    setBusy((b) => ({ ...b, [id]: label }))
    try {
      await api.post(`/api/channels/${encodeURIComponent(id)}/${path}`)
      setTimeout(load, 1000)
    } catch (e: any) {
      setErr(`${id}: ${e.message}`)
    } finally {
      setBusy((b) => ({ ...b, [id]: '' }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Channels</h1>
          <p className="page-sub">
            {rows.length} {rows.length === 1 ? 'channel' : 'channels'} {niche ? `in niche ${niche}` : 'imported'} ·
            click "Ingest all" to start the pipeline
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="niche-filter" className="sr-only">
            Filter by niche
          </label>
          <input
            id="niche-filter"
            name="niche"
            className="input input-sm w-44"
            placeholder="Filter niche (N001)"
            value={niche}
            onChange={(e) => setNiche(e.target.value.toUpperCase())}
          />
          <button className="btn-ghost btn-sm" onClick={load} type="button">
            ⟲ Refresh
          </button>
          <Link to="/import" className="btn-primary btn-sm">
            + Import
          </Link>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error bg-error-soft px-4 py-3 text-sm text-error" role="alert">
          {err}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card text-sm text-muted">
          No channels yet.{' '}
          <Link to="/import" className="font-medium text-accent hover:underline">
            Import a CSV
          </Link>{' '}
          to get started.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-edge bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left">
              <tr>
                <Th>Channel</Th>
                <Th>Status</Th>
                <Th right>Videos</Th>
                <Th right>Transcripts</Th>
                <Th right>Chunks</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.channel_id} className="border-t border-edge align-middle hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-[15px] font-medium text-white"
                        style={{ background: channelColor(r.channel_id) }}
                        aria-hidden
                      >
                        {channelInitials(r.channel_name, r.channel_id)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold leading-tight text-ink">{r.channel_name}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                          {r.channel_id} · {r.niche_id ?? '—'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <Td num>{r.video_count}</Td>
                  <Td num>{r.transcript_count}</Td>
                  <Td num>{r.chunk_count}</Td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        className="btn-secondary btn-sm"
                        disabled={!!busy[r.channel_id]}
                        onClick={() => act(r.channel_id, 'ingest-all', 'Ingesting…')}
                        type="button"
                      >
                        {busy[r.channel_id] || 'Ingest all'}
                      </button>
                      {r.chunk_count > 0 && (
                        <button
                          className="btn-ghost btn-sm"
                          disabled={!!busy[r.channel_id]}
                          onClick={() => act(r.channel_id, 'build-persona', 'Building…')}
                          type="button"
                        >
                          Build persona
                        </button>
                      )}
                      {r.persona_status === 'active' && (
                        <Link to={`/chat/${r.channel_id}`} className="btn-primary btn-sm">
                          Chat →
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-muted ${
        right ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, num }: { children: ReactNode; num?: boolean }) {
  return (
    <td
      className={`px-4 py-3 ${num ? 'text-right font-mono text-[13px] tabular-nums text-ink-2' : 'text-ink-2'}`}
    >
      {children === 0 ? '—' : children}
    </td>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'pill-success',
    pending: 'pill-neutral',
    inactive: 'pill-warning',
    blacklisted: 'pill-error',
  }
  const cls = map[status] || 'pill-neutral'
  return (
    <span className={cls}>
      <span className="dot" />
      {status}
    </span>
  )
}
