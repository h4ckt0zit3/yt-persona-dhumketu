#!/usr/bin/env node
// Orchestrator "hands" — the thin, auditable CLI the Conductor/Sentinel agents
// drive to read pipeline state and take SAFE actions against the deployed app.
//
// It does NOT contain pipeline logic (that lives in src/lib/pipeline.ts). It is
// purely a typed, allowlist-authenticated HTTP client over the /api routes,
// plus a conservative `tick` planner. The Cloudflare Cron (*/2) remains the
// real workhorse; this layer adds higher-level supervision on top.
//
// Usage:
//   node scripts/orchestrator.mjs state                 # consolidated health JSON
//   node scripts/orchestrator.mjs tick                  # plan + run FREE actions
//   node scripts/orchestrator.mjs tick --allow-scrape   # also start paid Apify ingests
//   node scripts/orchestrator.mjs tick --dry-run        # plan only, change nothing
//   node scripts/orchestrator.mjs embed   <channelId>   # force embed pending transcripts
//   node scripts/orchestrator.mjs persona <channelId>   # build/refresh one persona
//   node scripts/orchestrator.mjs ingest  <channelId>   # paid: full ingest (needs --allow-scrape)
//   node scripts/orchestrator.mjs cancel  <jobId>       # cancel a stuck running job
//
// Auth (in priority order):
//   1. AUTOMATION_TOKEN  — a raw Supabase access_token (env)
//   2. AUTOMATION_EMAIL + AUTOMATION_PASSWORD (env or app/.dev.vars) — password grant
// The email MUST be in ALLOWED_EMAILS (wrangler.toml). automation@dhumketu.space
// is already allowlisted; set its password once with:
//   node scripts/create-user.mjs automation@dhumketu.space "<password>"
// then put AUTOMATION_EMAIL / AUTOMATION_PASSWORD in app/.dev.vars (gitignored).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')

function fromFile(file, key) {
  try {
    const txt = readFileSync(resolve(appRoot, file), 'utf8')
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\n]+)`, 'm'))
    return m?.[1]?.trim()
  } catch {
    return undefined
  }
}

const argv = process.argv.slice(2)
const cmd = argv[0]
const positionals = argv.slice(1).filter((a) => !a.startsWith('--'))
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const flagVal = (name) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : undefined
}

const BASE_URL = (
  flagVal('--base') ||
  process.env.ORCH_BASE_URL ||
  fromFile('wrangler.toml', 'PUBLIC_URL') ||
  'https://youtube-personas.thisisjoyjacob.workers.dev'
).replace(/\/$/, '')

const SUPABASE_URL = process.env.SUPABASE_URL || fromFile('wrangler.toml', 'SUPABASE_URL')
const ANON_KEY = process.env.SUPABASE_ANON_KEY || fromFile('wrangler.toml', 'SUPABASE_ANON_KEY')

const DRY_RUN = flags.has('--dry-run')
const ALLOW_SCRAPE = flags.has('--allow-scrape')

function die(msg, extra) {
  console.error(`✗ ${msg}`)
  if (extra) console.error(extra)
  process.exit(1)
}

// ---- Auth: obtain a bearer token the /api auth gate accepts -------------
let _token = null
async function getToken() {
  if (_token) return _token
  const raw = process.env.AUTOMATION_TOKEN
  if (raw) return (_token = raw)

  const email = process.env.AUTOMATION_EMAIL || fromFile('.dev.vars', 'AUTOMATION_EMAIL')
  const password = process.env.AUTOMATION_PASSWORD || fromFile('.dev.vars', 'AUTOMATION_PASSWORD')
  if (!email || !password) {
    die(
      'No credentials. Set AUTOMATION_TOKEN, or AUTOMATION_EMAIL + AUTOMATION_PASSWORD ' +
        '(env or app/.dev.vars).',
      'First time: node scripts/create-user.mjs automation@dhumketu.space "<password>"',
    )
  }
  if (!SUPABASE_URL || !ANON_KEY) die('Missing SUPABASE_URL / SUPABASE_ANON_KEY (wrangler.toml).')

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    die(`Supabase sign-in failed (${res.status}) for ${email}.`, JSON.stringify(body))
  }
  return (_token = body.access_token)
}

// ---- HTTP helper over /api ----------------------------------------------
async function call(method, path, { body, raw } = {}) {
  const token = await getToken()
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (raw) return { status: res.status, data }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  return data
}

const GET = (p) => call('GET', p)
const POST = (p, body) => call('POST', p, { body })

// ---- Commands ------------------------------------------------------------

// Consolidated read-only snapshot the agents reason over.
async function cmdState() {
  const [stats, cronHealth, activity, jobs] = await Promise.all([
    GET('/stats'),
    GET('/cron-health'),
    GET('/activity'),
    GET('/jobs'),
  ])
  const runningJobs = (jobs || []).filter((j) => j.status === 'running')
  const failedJobs = (jobs || []).filter((j) => j.status === 'failed').slice(0, 5)
  const snapshot = {
    base_url: BASE_URL,
    fetched_at: new Date().toISOString(),
    stats,
    queues: cronHealth.queues,
    cron: cronHealth.crons,
    running_jobs: runningJobs.map((j) => ({
      id: j.id,
      type: j.job_type,
      channel_id: j.channel_id,
      started_at: j.started_at,
    })),
    recent_failures: failedJobs.map((j) => ({
      id: j.id,
      type: j.job_type,
      channel_id: j.channel_id,
      error: j.error_message,
    })),
    activity_now: activity.stages,
  }
  console.log(JSON.stringify(snapshot, null, 2))
  return snapshot
}

// Detect a chunk/embedding count on a channel_overview row without hard-coding
// the exact column name (the view is the source of truth, not this script).
function chunkCountOf(row) {
  for (const k of Object.keys(row)) {
    if (/(chunk|embed)/i.test(k) && typeof row[k] === 'number') return row[k]
  }
  return null
}

// The conservative planner. FREE actions run by default; PAID (Apify) actions
// only with --allow-scrape. Embedding is owned by the Cloudflare Cron; we report
// its depth but don't double-drive it per-channel here.
async function cmdTick() {
  const [channels, personas, cronHealth] = await Promise.all([
    GET('/channels'),
    GET('/personas'),
    GET('/cron-health'),
  ])
  const activePersona = new Set((personas || []).map((p) => p.channel_id))
  const plan = { free: [], paid: [], skipped: [], notes: [] }

  for (const ch of channels || []) {
    const id = ch.channel_id
    const chunks = chunkCountOf(ch)

    // Phase 6 (FREE): channel has embedded knowledge but no active persona.
    if (!activePersona.has(id) && (chunks === null || chunks > 0) && ch.status === 'active') {
      plan.free.push({ action: 'build-persona', channel_id: id, reason: `chunks=${chunks ?? '?'}` })
      continue
    }
    // Phase 2/3 (PAID): channel discovered but never scraped.
    if (ch.status === 'pending') {
      plan.paid.push({ action: 'ingest-all', channel_id: id, reason: 'status=pending' })
      continue
    }
    plan.skipped.push(id)
  }

  const q = cronHealth.queues
  if (q.transcripts.pending > 0)
    plan.notes.push(`${q.transcripts.pending} transcripts pending embedding — Cloudflare Cron drains these (3/tick).`)
  if (q.transcripts.failed > 0) plan.notes.push(`${q.transcripts.failed} transcripts FAILED embedding — needs attention.`)
  if (q.videos.failed > 0) plan.notes.push(`${q.videos.failed} videos FAILED transcription.`)

  console.log('── PLAN ' + '─'.repeat(50))
  console.log(JSON.stringify(plan, null, 2))
  if (DRY_RUN) {
    console.log('\n(dry-run: nothing executed)')
    return plan
  }

  // Execute FREE actions.
  const results = []
  for (const a of plan.free) {
    if (a.action === 'build-persona') {
      const r = await call('POST', `/channels/${a.channel_id}/build-persona`, { body: {}, raw: true })
      results.push({ ...a, status: r.status, ok: r.data?.ok ?? r.status === 200, detail: r.data?.error })
    }
  }
  // Execute PAID actions only when explicitly allowed.
  if (ALLOW_SCRAPE) {
    for (const a of plan.paid) {
      const r = await call('POST', `/channels/${a.channel_id}/ingest-all`, { body: {}, raw: true })
      results.push({ ...a, status: r.status, ok: r.status === 200, detail: r.data?.error || r.data?.jobId })
    }
  } else if (plan.paid.length) {
    console.log(`\n⏸  ${plan.paid.length} PAID ingest action(s) held — re-run with --allow-scrape to start them.`)
  }

  console.log('\n── EXECUTED ' + '─'.repeat(46))
  console.log(JSON.stringify(results, null, 2))
  return { plan, results }
}

async function cmdEmbed(id) {
  if (!id) die('Usage: orchestrator.mjs embed <channelId>')
  console.log(JSON.stringify(await POST(`/channels/${id}/embed-now`, {}), null, 2))
}
async function cmdPersona(id) {
  if (!id) die('Usage: orchestrator.mjs persona <channelId>')
  console.log(JSON.stringify(await POST(`/channels/${id}/build-persona`, {}), null, 2))
}
async function cmdIngest(id) {
  if (!id) die('Usage: orchestrator.mjs ingest <channelId> --allow-scrape')
  if (!ALLOW_SCRAPE) die('Refusing paid Apify ingest without --allow-scrape.')
  console.log(JSON.stringify(await POST(`/channels/${id}/ingest-all`, {}), null, 2))
}
async function cmdCancel(id) {
  if (!id) die('Usage: orchestrator.mjs cancel <jobId>')
  console.log(JSON.stringify(await call('POST', `/jobs/${id}/cancel`, { body: {}, raw: true }), null, 2))
}

const COMMANDS = {
  state: cmdState,
  tick: cmdTick,
  embed: () => cmdEmbed(positionals[0]),
  persona: () => cmdPersona(positionals[0]),
  ingest: () => cmdIngest(positionals[0]),
  cancel: () => cmdCancel(positionals[0]),
}

const fn = COMMANDS[cmd]
if (!fn) {
  console.error('Commands: state | tick [--allow-scrape] [--dry-run] | embed <id> | persona <id> | ingest <id> | cancel <jobId>')
  console.error(`Base URL: ${BASE_URL}`)
  process.exit(cmd ? 1 : 0)
}
fn().catch((e) => die(e.message))
