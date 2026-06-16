import { Hono } from 'hono'
import Papa from 'papaparse'
import type { Env, ChatMessage } from './types'
import { getDb } from './lib/supabase'
import { toInt } from './lib/csv'

// Wraps papaparse with header-keyed rows, trims keys/values, drops blank lines.
function parseCsv(text: string): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === 'string' ? v.trim() : v),
  })
  return res.data ?? []
}
import {
  processFinishedJob,
  pollRunningJobs,
  cancelJob,
  liveScrapeDisabled,
  SCRAPE_DISABLED_MESSAGE,
} from './lib/pipeline'
import { startVideoExtraction } from './stages/fetch'
import { startTranscriptExtraction } from './stages/transcribe'
import { buildPersona } from './stages/persona'
import { failJob } from './stages/jobs'
import { embedChannelNow } from './lib/embed'
import { seedReferenceData, seedDemoChannel } from './lib/seed'
import { requireAuth, type AuthVars } from './lib/auth'
import { pipelineHealth } from './stages/monitor'
import { personaChat } from './stages/chat'
import { AppError } from './lib/errors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export const api = new Hono<{ Bindings: Env; Variables: AuthVars }>()

// Surface real error messages instead of bare 500s. AppError gives structured
// JSON the frontend can act on (retry button for retryable, distinct copy per
// code). Any non-AppError throw still gets logged and returned as a 500.
api.onError((err, c) => {
  console.error('[api error]', err)
  if (err instanceof AppError) {
    return c.json(err.toJSON(), err.status as ContentfulStatusCode)
  }
  return c.json(
    {
      error: err.message || String(err),
      code: 'internal',
      retryable: false,
      stack: (err as any).stack?.split('\n').slice(0, 3),
    },
    500,
  )
})

// Auth gate (skips /health, /config, /webhooks/* — see lib/auth.ts).
api.use('*', requireAuth)

api.get('/health', (c) => c.json({ ok: true }))

// Public bootstrap config for the browser (Supabase URL + anon key are
// PUBLIC by design — anon key is locked down by RLS server-side).
api.get('/config', (c) =>
  c.json({
    supabase_url: c.env.SUPABASE_URL,
    supabase_anon_key: c.env.SUPABASE_ANON_KEY,
    // When true the frontend auto-signs-in and skips the magic-link flow.
    dev_auth: c.env.DEV_AUTH === 'true',
    dev_email: c.env.DEV_AUTH === 'true' ? c.env.DEV_EMAIL || 'dev@local' : null,
    embed_provider: c.env.EMBED_PROVIDER,
  }),
)

// ---- Dashboard stats ----------------------------------------------------
api.get('/stats', async (c) => {
  const db = getDb(c.env)
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = db.from(table).select('*', { count: 'exact', head: true })
    if (filter) q = filter(q)
    const { count } = await q
    return count ?? 0
  }
  const [niches, channels, active, videos, transcripts, personas, chunks] = await Promise.all([
    count('niches'),
    count('channels'),
    count('channels', (q) => q.eq('status', 'active')),
    count('videos'),
    count('transcripts'),
    count('personas', (q) => q.eq('status', 'active')),
    count('embeddings'),
  ])
  return c.json({ niches, channels, active_channels: active, videos, transcripts, personas, chunks })
})

// ---- CSV import ---------------------------------------------------------
api.post('/import/niches', async (c) => {
  const raw = await c.req.text()
  const allRows = parseCsv(raw)
  const headers = allRows[0] ? Object.keys(allRows[0]) : []
  const rows = allRows.filter((r) => r.niche_id)
  if (rows.length === 0) {
    return c.json(
      {
        error:
          `No rows imported. Parsed ${allRows.length} data row(s) from ${raw.length} bytes. ` +
          `Headers detected: [${headers.join(', ') || 'none'}]. ` +
          `Required: niche_id.`,
        first_row: allRows[0] ?? null,
      },
      400,
    )
  }
  const mapped = rows.map((r) => ({
    niche_id: r.niche_id,
    domain: r.domain || '',
    niche: r.niche || '',
    sub_niche: r.sub_niche || '',
    format_type: r.format_type || 'Monologue',
    avg_cpm_usd: r.avg_cpm_usd || null,
    difficulty: r.difficulty || null,
    persona_potential: r.persona_potential || null,
    description: r.description || null,
  }))
  const n = await upsertBatched(c.env, 'niches', mapped, 'niche_id')
  return c.json({ imported: n })
})

api.post('/import/channels', async (c) => {
  const raw = await c.req.text()
  const allRows = parseCsv(raw)
  const headers = allRows[0] ? Object.keys(allRows[0]) : []
  const rows = allRows.filter((r) => r.channel_id && r.channel_url)
  if (rows.length === 0) {
    return c.json(
      {
        error:
          `No rows imported. Parsed ${allRows.length} data row(s) from ${raw.length} bytes. ` +
          `Headers detected: [${headers.join(', ') || 'none'}]. ` +
          `Required: channel_id and channel_url.`,
        first_row: allRows[0] ?? null,
      },
      400,
    )
  }
  const mapped = rows.map((r) => ({
    channel_id: r.channel_id,
    niche_id: r.niche_id || null,
    channel_name: r.channel_name || r.channel_id,
    channel_url: r.channel_url,
    subscriber_count: toInt(r.subscriber_count),
    total_videos: toInt(r.total_videos),
    avg_views: toInt(r.avg_views),
    format_type: r.format_type || 'monologue',
    language: r.language || 'en',
    country: r.country || null,
    description: r.description || null,
    status: r.status || 'pending',
  }))
  const n = await upsertBatched(c.env, 'channels', mapped, 'channel_id')
  return c.json({ imported: n })
})

async function upsertBatched(env: Env, table: string, rows: any[], onConflict: string): Promise<number> {
  const db = getDb(env)
  // Postgres rejects an upsert whose batch repeats a conflict key ("cannot
  // affect row a second time"), so collapse dupes first (last write wins) —
  // a CSV with a duplicated id would otherwise fail the entire import.
  const byKey = new Map<string, any>()
  for (const r of rows) byKey.set(String(r[onConflict]), r)
  const deduped = [...byKey.values()]
  let n = 0
  for (let i = 0; i < deduped.length; i += 200) {
    const slice = deduped.slice(i, i + 200)
    const { error } = await db.from(table).upsert(slice, { onConflict })
    if (error) throw new Error(error.message)
    n += slice.length
  }
  return n
}

// ---- Niches -------------------------------------------------------------
api.get('/niches', async (c) => {
  const db = getDb(c.env)
  const { data, error } = await db
    .from('niches')
    .select('niche_id, domain, niche, sub_niche, persona_potential, avg_cpm_usd, description')
    .order('niche_id', { ascending: true })
  if (error) return c.json({ error: error.message }, 500)

  // Channel counts per niche, computed without a PostgREST relationship (the
  // niches<->channels FK isn't registered in the schema cache). One column
  // scan, tallied here — fine at free-tier scale.
  const { data: chRows } = await db.from('channels').select('niche_id').limit(5000)
  const counts: Record<string, number> = {}
  for (const r of chRows ?? []) {
    const k = (r as any).niche_id
    if (k) counts[k] = (counts[k] ?? 0) + 1
  }
  const out = (data ?? []).map((n: any) => ({ ...n, channel_count: counts[n.niche_id] ?? 0 }))
  return c.json(out)
})

// ---- Channels -----------------------------------------------------------
api.get('/channels', async (c) => {
  const db = getDb(c.env)
  let q = db.from('channel_overview').select('*').order('subscriber_count', { ascending: false, nullsFirst: false }).limit(500)
  const niche = c.req.query('niche')
  const status = c.req.query('status')
  if (niche) q = q.eq('niche_id', niche)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

api.get('/channels/:id', async (c) => {
  const db = getDb(c.env)
  const id = c.req.param('id')
  const { data: channel } = await db.from('channels').select('*').eq('channel_id', id).maybeSingle()
  if (!channel) return c.json({ error: 'not found' }, 404)
  const { data: jobs } = await db
    .from('pipeline_jobs')
    .select('id, job_type, status, output_stats, error_message, created_at')
    .eq('channel_id', id)
    .order('created_at', { ascending: false })
    .limit(10)
  return c.json({ channel, jobs: jobs ?? [] })
})

async function getChannel(env: Env, id: string) {
  const { data } = await getDb(env)
    .from('channels')
    .select('channel_id, niche_id, channel_name, channel_url')
    .eq('channel_id', id)
    .maybeSingle()
  return data
}

// Live Apify scraping is blocked in local dev — see liveScrapeDisabled().
const scrapeGuard = (c: any) =>
  liveScrapeDisabled(c.env)
    ? c.json({ error: SCRAPE_DISABLED_MESSAGE, code: 'scrape_disabled_in_dev', retryable: false }, 400)
    : null

api.post('/channels/:id/ingest-videos', async (c) => {
  const blocked = scrapeGuard(c)
  if (blocked) return blocked
  const ch = await getChannel(c.env, c.req.param('id'))
  if (!ch) return c.json({ error: 'not found' }, 404)
  const jobId = await startVideoExtraction(c.env, ch as any, false)
  return c.json({ ok: true, jobId })
})

api.post('/channels/:id/ingest-transcripts', async (c) => {
  const blocked = scrapeGuard(c)
  if (blocked) return blocked
  const ch = await getChannel(c.env, c.req.param('id'))
  if (!ch) return c.json({ error: 'not found' }, 404)
  const r = await startTranscriptExtraction(c.env, ch as any)
  return c.json({ ok: true, ...r })
})

api.post('/channels/:id/ingest-all', async (c) => {
  const blocked = scrapeGuard(c)
  if (blocked) return blocked
  const ch = await getChannel(c.env, c.req.param('id'))
  if (!ch) return c.json({ error: 'not found' }, 404)
  const jobId = await startVideoExtraction(c.env, ch as any, true)
  return c.json({ ok: true, jobId, note: 'transcripts + embeddings run automatically after the video scrape finishes' })
})

// Synchronous embed: chunk + embed every pending transcript for this channel
// right now (no 2-min Cron wait) and report exactly what happened. This is the
// step the offline test path hangs on, so we surface per-transcript errors.
api.post('/channels/:id/embed-now', async (c) => {
  const r = await embedChannelNow(c.env, c.req.param('id'))
  return c.json(r, r.errors.length > 0 && r.processed === 0 ? 207 : 200)
})

api.post('/channels/:id/build-persona', async (c) => {
  const r = await buildPersona(c.env, c.req.param('id'))
  return c.json(r, r.ok ? 200 : 400)
})

// ---- Videos / jobs ------------------------------------------------------
api.get('/videos', async (c) => {
  const channel = c.req.query('channel')
  if (!channel) return c.json({ error: 'channel required' }, 400)
  const { data } = await getDb(c.env)
    .from('videos')
    .select('video_id, video_title, video_url, duration_seconds, view_count, transcript_status')
    .eq('channel_id', channel)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(500)
  return c.json(data ?? [])
})

api.get('/jobs', async (c) => {
  const db = getDb(c.env)
  const channel = c.req.query('channel')
  // Hide cron_* rows from the user-facing activity feed; those are exposed
  // separately via /api/cron-health.
  let q = db
    .from('pipeline_jobs')
    .select('*')
    .not('job_type', 'like', 'cron_%')
    .order('created_at', { ascending: false })
    .limit(25)
  if (channel) q = q.eq('channel_id', channel)
  const { data } = await q
  return c.json(data ?? [])
})

// Cancel/resolve a single stuck job (the LiveMonitor "Resolve" button).
api.post('/jobs/:id/cancel', async (c) => {
  const r = await cancelJob(c.env, c.req.param('id'))
  return c.json(r.body, r.status as ContentfulStatusCode)
})

// ---- Cron health --------------------------------------------------------
// Exposes the most recent run of each background cron + transcript/embedding
// queue depth. The Dashboard surfaces this so silent failures (e.g. Workers
// AI quota blown) don't hide behind a stuck Chunks counter.
api.get('/cron-health', async (c) => {
  const db = getDb(c.env)
  const cronTypes = ['cron_embed_drain', 'cron_apify_poll']
  const lastRuns = await Promise.all(
    cronTypes.map(async (type) => {
      const { data } = await db
        .from('pipeline_jobs')
        .select('job_type, status, output_stats, error_message, started_at, completed_at')
        .eq('job_type', type)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return [type, data] as const
    }),
  )

  const queueCount = async (table: 'transcripts' | 'videos', column: string, value: string) => {
    const { count } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, value)
    return count ?? 0
  }
  const [
    transcriptsPending,
    transcriptsProcessing,
    transcriptsFailed,
    videosPending,
    videosFailed,
  ] = await Promise.all([
    queueCount('transcripts', 'embedding_status', 'pending'),
    queueCount('transcripts', 'embedding_status', 'processing'),
    queueCount('transcripts', 'embedding_status', 'failed'),
    queueCount('videos', 'transcript_status', 'pending'),
    queueCount('videos', 'transcript_status', 'failed'),
  ])

  return c.json({
    crons: Object.fromEntries(lastRuns),
    queues: {
      transcripts: {
        pending: transcriptsPending,
        processing: transcriptsProcessing,
        failed: transcriptsFailed,
      },
      videos: { pending: videosPending, failed: videosFailed },
    },
    now: new Date().toISOString(),
  })
})

// ---- Pipeline stage health (v2 monitor) ---------------------------------
// One call → per-stage {queue, inflight, failed, lastRunAt, lastError} mapped
// onto the 5-stage model so you can see which stage is stuck. See
// app/src/stages/monitor.ts and docs/PERSONAS-V2-RESTRUCTURE.md.
api.get('/pipeline', async (c) => c.json(await pipelineHealth(c.env)))

// ---- Live activity ------------------------------------------------------
// One cheap call the real-time monitor polls every ~2s: what is actually
// executing in the backend right now (running Apify jobs, transcripts being
// embedded), queue depth per stage, and the cron heartbeat. Powers the live
// process graphics so it's obvious whether anything is moving.
api.get('/activity', async (c) => {
  const db = getDb(c.env)

  // Fast path: one round-trip via the get_activity() SQL function (apply
  // schema-activity-rpc.sql). If the function isn't present, error out quietly
  // and fall through to the multi-query path below — so the migration is purely
  // an optimization, never required.
  const rpc = await db.rpc('get_activity')
  if (!rpc.error && rpc.data) {
    return c.json({ ...(rpc.data as Record<string, unknown>), now: new Date().toISOString() })
  }

  const { data: running } = await db
    .from('pipeline_jobs')
    .select('id, job_type, status, channel_id, started_at, input_params')
    .eq('status', 'running')
    .not('job_type', 'like', 'cron_%')
    .order('started_at', { ascending: false })
    .limit(50)

  // One scan per table over only the ACTIVE rows (completed excluded), tallied
  // in-process — collapses what used to be 5 separate count/inflight queries
  // into 2. Capped at ACTIVE_CAP; counts at/above the cap render as "N+".
  const ACTIVE_CAP = 2000
  const [trRows, vidRows] = await Promise.all([
    db
      .from('transcripts')
      .select('channel_id, embedding_status')
      .in('embedding_status', ['processing', 'pending', 'failed'])
      .limit(ACTIVE_CAP),
    db
      .from('videos')
      .select('channel_id, transcript_status')
      .in('transcript_status', ['processing', 'pending'])
      .limit(ACTIVE_CAP),
  ])
  const transcripts = (trRows.data ?? []) as { channel_id: string | null; embedding_status: string }[]
  const videos = (vidRows.data ?? []) as { channel_id: string | null; transcript_status: string }[]

  const embedding = transcripts.filter((r) => r.embedding_status === 'processing')
  const transcribing = videos.filter((r) => r.transcript_status === 'processing')
  const transcriptsPending = transcripts.filter((r) => r.embedding_status === 'pending').length
  const transcriptsFailed = transcripts.filter((r) => r.embedding_status === 'failed').length
  const videosPending = videos.filter((r) => r.transcript_status === 'pending').length

  const lastCron = async (type: string) => {
    const { data } = await db
      .from('pipeline_jobs')
      .select('status, completed_at, output_stats, error_message')
      .eq('job_type', type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data
  }
  const [embedDrain, apifyPoll] = await Promise.all([lastCron('cron_embed_drain'), lastCron('cron_apify_poll')])

  const tally = (rows: { channel_id: string | null }[]) => {
    const m: Record<string, number> = {}
    for (const r of rows) if (r.channel_id) m[r.channel_id] = (m[r.channel_id] ?? 0) + 1
    return m
  }

  return c.json({
    now: new Date().toISOString(),
    running_jobs: running ?? [],
    stages: {
      transcribing: { count: transcribing.length, by_channel: tally(transcribing) },
      embedding: { count: embedding.length, by_channel: tally(embedding) },
    },
    queues: {
      transcripts_pending: transcriptsPending,
      transcripts_failed: transcriptsFailed,
      videos_pending: videosPending,
    },
    cron: { embed_drain: embedDrain, apify_poll: apifyPoll },
  })
})

// ---- Personas -----------------------------------------------------------
api.get('/personas', async (c) => {
  const { data, error } = await getDb(c.env)
    .from('personas')
    .select('channel_id, persona_name, niche_id, status, style_profile, knowledge_stats, channels(channel_url, description)')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  // flatten the joined channel fields
  const out = (data ?? []).map((p: any) => ({
    ...p,
    channel_url: p.channels?.channel_url ?? null,
    description: p.channels?.description ?? null,
  }))
  return c.json(out)
})

api.get('/personas/:id', async (c) => {
  const { data } = await getDb(c.env).from('personas').select('*').eq('channel_id', c.req.param('id')).maybeSingle()
  if (!data) return c.json({ error: 'not found' }, 404)
  return c.json(data)
})

// ---- Chat (streaming) ---------------------------------------------------
api.post('/chat', async (c) => {
  const { channel_id, messages } = await c.req.json<{ channel_id: string; messages: ChatMessage[] }>()
  const r = await personaChat(c.env, channel_id, messages)
  if (!r.ok) return c.json({ error: r.error }, r.status)
  return new Response(r.stream, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
})

// ---- Seed / dev tooling -------------------------------------------------
// One-click load of the repo's niches + channels (bundled into the worker) so
// nobody has to paste CSVs. `demo=1` also inserts a demo channel with sample
// transcripts (embedding_status=pending) for the fully-offline persona test.
api.post('/dev/seed', async (c) => {
  const ref = await seedReferenceData(c.env)
  const demo = c.req.query('demo') === '1' || c.req.query('demo') === 'true'
  const demoResult = demo ? await seedDemoChannel(c.env) : null
  return c.json({ ok: true, ...ref, demo: demoResult })
})

// Force an Apify status poll now instead of waiting for the 2-min cron — used
// by the "Poll Apify now" button when a live scrape looks stuck.
api.post('/dev/poll-now', async (c) => {
  await pollRunningJobs(c.env)
  return c.json({ ok: true })
})

// ---- Apify webhook ------------------------------------------------------
api.post('/webhooks/apify', async (c) => {
  if (c.req.query('secret') !== c.env.WEBHOOK_SECRET) return c.json({ error: 'forbidden' }, 403)
  const jobId = c.req.query('jobId')
  if (!jobId) return c.json({ error: 'jobId required' }, 400)

  let status = 'SUCCEEDED'
  try {
    const payload = await c.req.json<any>()
    status = payload?.resource?.status ?? payload?.eventType?.replace('ACTOR.RUN.', '') ?? 'SUCCEEDED'
  } catch {
    /* some webhook tests send no body */
  }

  if (status === 'SUCCEEDED') {
    c.executionCtx.waitUntil(processFinishedJob(c.env, jobId))
  } else {
    c.executionCtx.waitUntil(failJob(c.env, jobId, `Apify run ${status}`))
  }
  return c.json({ ok: true })
})
