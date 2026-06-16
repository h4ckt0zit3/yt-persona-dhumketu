import { useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export default function Import() {
  const [csv, setCsv] = useState('')
  const [kind, setKind] = useState<'channels' | 'niches'>('channels')
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setCsv(await f.text())
  }

  async function submit() {
    setBusy(true)
    setMsg('')
    setIsError(false)
    try {
      const res = await api.postCsv<{ imported: number }>(`/api/import/${kind}`, csv)
      setMsg(`Imported ${res.imported} ${kind}.`)
    } catch (e: any) {
      setMsg(`Error: ${e.message}`)
      setIsError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Import CSV</h1>
        <p className="page-sub">
          Paste or upload a CSV matching your repo files: <code className="font-mono text-ink">channels-master.csv</code>{' '}
          (or a per-niche file) for channels, <code className="font-mono text-ink">niches-master.csv</code> for niches.
          Re-importing updates existing rows by id.
        </p>
      </div>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="import-kind" className="mb-1.5 block text-xs font-medium text-ink-2">
              What are you importing?
            </label>
            <select
              id="import-kind"
              name="kind"
              className="input input-sm w-44"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'channels' | 'niches')}
            >
              <option value="channels">Channels</option>
              <option value="niches">Niches</option>
            </select>
          </div>
          <div className="flex-1 min-w-[260px]">
            <label htmlFor="import-file" className="mb-1.5 block text-xs font-medium text-ink-2">
              Or upload a file
            </label>
            <input
              id="import-file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-sm file:border file:border-edge-strong file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink-2 hover:file:bg-surface-2"
            />
          </div>
        </div>

        <div>
          <label htmlFor="import-csv" className="mb-1.5 block text-xs font-medium text-ink-2">
            CSV content
          </label>
          <textarea
            id="import-csv"
            name="csv"
            className="input h-72 font-mono text-xs leading-relaxed"
            placeholder="channel_id,niche_id,channel_name,channel_url,subscriber_count,..."
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={busy || !csv.trim()} onClick={submit} type="button">
            {busy ? 'Importing…' : `Import ${kind}`}
          </button>
          <Link to="/channels" className="btn-ghost btn-sm">
            View channels
          </Link>
          {msg && (
            <span className={`text-sm ${isError ? 'text-error' : 'text-success'}`} aria-live="polite">
              {msg}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
