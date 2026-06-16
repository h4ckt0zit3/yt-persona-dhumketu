import Papa from 'papaparse'
import type { Env } from '../types'
import { getDb } from './supabase'
import { toInt } from './csv'
import {
  NICHES_CSV,
  CHANNELS_CSV,
  DEMO_NICHE,
  DEMO_CHANNEL,
  DEMO_TRANSCRIPTS,
} from '../generated/seedData'

const nowIso = () => new Date().toISOString()

function parseCsv(text: string): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === 'string' ? v.trim() : v),
  })
  return (res.data ?? []).filter((r) => Object.keys(r).length > 0)
}

// Postgres rejects an upsert whose batch contains the same conflict key twice
// ("cannot affect row a second time"), so collapse dupes (last write wins).
function dedupeBy<T extends Record<string, any>>(rows: T[], key: string): T[] {
  const m = new Map<string, T>()
  for (const r of rows) m.set(String(r[key]), r)
  return [...m.values()]
}

async function upsertBatched(env: Env, table: string, rows: any[], onConflict: string): Promise<number> {
  const db = getDb(env)
  rows = dedupeBy(rows, onConflict)
  let n = 0
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const { error } = await db.from(table).upsert(slice, { onConflict })
    if (error) throw new Error(`${table} upsert failed: ${error.message}`)
    n += slice.length
  }
  return n
}

function mapNiche(r: Record<string, string>) {
  return {
    niche_id: r.niche_id,
    domain: r.domain || '',
    niche: r.niche || '',
    sub_niche: r.sub_niche || '',
    format_type: r.format_type || 'Monologue',
    avg_cpm_usd: r.avg_cpm_usd || null,
    difficulty: r.difficulty || null,
    persona_potential: r.persona_potential || null,
    description: r.description || null,
  }
}

function mapChannel(r: Record<string, string>) {
  return {
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
  }
}

// Load the repo's reference niches + channels (bundled into the worker) so the
// app is populated without anyone pasting CSVs. Idempotent (upsert by id).
export async function seedReferenceData(env: Env): Promise<{ niches: number; channels: number }> {
  const niches = parseCsv(NICHES_CSV).filter((r) => r.niche_id).map(mapNiche)
  // Always include the demo niche so the demo channel has a valid FK.
  niches.push(mapNiche(DEMO_NICHE as any))
  const nicheCount = await upsertBatched(env, 'niches', niches, 'niche_id')

  const channels = parseCsv(CHANNELS_CSV)
    .filter((r) => r.channel_id && r.channel_url)
    .map(mapChannel)
  const channelCount = await upsertBatched(env, 'channels', channels, 'channel_id')

  return { niches: nicheCount, channels: channelCount }
}

// Insert the demo channel + sample transcripts (embedding_status=pending) so the
// chunk -> embed -> persona path can run fully offline. Safe to re-run.
export async function seedDemoChannel(
  env: Env,
): Promise<{ channel_id: string; videos: number; transcripts: number }> {
  const db = getDb(env)
  await db.from('niches').upsert(mapNiche(DEMO_NICHE as any), { onConflict: 'niche_id' })
  await db.from('channels').upsert(
    { ...mapChannel(DEMO_CHANNEL as any), status: 'active', last_scraped: nowIso() },
    { onConflict: 'channel_id' },
  )

  let videos = 0
  let transcripts = 0
  for (const t of DEMO_TRANSCRIPTS) {
    await db.from('videos').upsert(
      {
        video_id: t.video_id,
        channel_id: DEMO_CHANNEL.channel_id,
        niche_id: DEMO_CHANNEL.niche_id,
        video_title: t.video_title,
        video_url: `https://www.youtube.com/watch?v=${t.video_id}`,
        duration_seconds: 600,
        view_count: 1_000_000,
        transcript_status: 'completed',
        has_transcript: true,
        last_scraped: nowIso(),
      },
      { onConflict: 'video_id' },
    )
    videos++
    await db.from('transcripts').upsert(
      {
        video_id: t.video_id,
        channel_id: DEMO_CHANNEL.channel_id,
        niche_id: DEMO_CHANNEL.niche_id,
        language: 'en',
        raw_text: t.text,
        word_count: t.text.trim() ? t.text.trim().split(/\s+/).length : 0,
        extraction_method: 'seed_sample',
        embedding_status: 'pending',
      },
      { onConflict: 'video_id' },
    )
    transcripts++
  }
  return { channel_id: DEMO_CHANNEL.channel_id, videos, transcripts }
}
