// Personas v2 — pipeline health monitor.
//
// Maps the live system onto the 5-stage model (fetch → transcribe → clean →
// chunk → embed) so a human can see, in one call, WHICH stage is backed up or
// failing and WHY. This is the read side of the v2 goal: debugging in seconds.
//
// Granularity note: until the P5 schema split (per-stage status columns +
// chunks table), clean/chunk/embed share one backlog (transcripts.embedding_
// status). We still attribute FAILURES across the three by parsing the
// stage-tagged error messages ([clean]/[chunk]/[embed]) the embed pipeline now
// emits — so even folded, you can tell which sub-stage is breaking.
import type { Env } from '../types'
import { getDb } from '../lib/supabase'
import type { StageHealth, StageId } from './contract'

const TITLES: Record<StageId, string> = {
  fetch: 'Fetch videos',
  transcribe: 'Transcribe & save',
  clean: 'Clean',
  chunk: 'Chunk',
  embed: 'Embed',
  chat: 'RAG chat',
}

type Db = ReturnType<typeof getDb>

async function tableCount(db: Db, table: string, col: string, val: string): Promise<number> {
  const { count } = await db.from(table).select('*', { count: 'exact', head: true }).eq(col, val)
  return count ?? 0
}

async function jobCount(db: Db, jobType: string, status: string): Promise<number> {
  const { count } = await db
    .from('pipeline_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('job_type', jobType)
    .eq('status', status)
  return count ?? 0
}

async function lastJob(db: Db, jobType: string) {
  const { data } = await db
    .from('pipeline_jobs')
    .select('status, error_message, completed_at, output_stats')
    .eq('job_type', jobType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as
    | { status: string; error_message: string | null; completed_at: string | null; output_stats: any }
    | null
}

// Bucket the most recent embed-drain's tagged error messages by sub-stage.
function tagFailures(lastEmbedDrain: { output_stats?: any } | null): Record<'clean' | 'chunk' | 'embed', number> {
  const out = { clean: 0, chunk: 0, embed: 0 }
  const msgs: { message?: string }[] = lastEmbedDrain?.output_stats?.error_messages ?? []
  for (const m of msgs) {
    const text = m?.message ?? ''
    if (text.startsWith('[clean]')) out.clean++
    else if (text.startsWith('[chunk]')) out.chunk++
    else out.embed++ // untagged embed-pipeline failures default to embed
  }
  return out
}

export interface PipelineHealth {
  now: string
  stages: StageHealth[]
}

export async function pipelineHealth(env: Env): Promise<PipelineHealth> {
  const db = getDb(env)

  const [
    channelsPending,
    fetchInflight,
    fetchFailed,
    lastFetch,
    videosPending,
    videosProcessing,
    videosFailed,
    lastTranscribe,
    transcriptsPending,
    transcriptsProcessing,
    transcriptsFailed,
    lastEmbed,
  ] = await Promise.all([
    tableCount(db, 'channels', 'status', 'pending'),
    jobCount(db, 'video_extraction', 'running'),
    jobCount(db, 'video_extraction', 'failed'),
    lastJob(db, 'video_extraction'),
    tableCount(db, 'videos', 'transcript_status', 'pending'),
    tableCount(db, 'videos', 'transcript_status', 'processing'),
    tableCount(db, 'videos', 'transcript_status', 'failed'),
    lastJob(db, 'transcript_extraction'),
    tableCount(db, 'transcripts', 'embedding_status', 'pending'),
    tableCount(db, 'transcripts', 'embedding_status', 'processing'),
    tableCount(db, 'transcripts', 'embedding_status', 'failed'),
    lastJob(db, 'cron_embed_drain'),
  ])

  const tags = tagFailures(lastEmbed)
  const embedLastRunAt = lastEmbed?.completed_at ?? null
  const embedLastErr = lastEmbed?.error_message ?? null

  // clean & chunk currently share the embed backlog; their failures are the
  // tagged subset. `folded: true` tells the UI to render them as not-yet-split.
  const folded = (id: StageId, failed: number): StageHealth & { folded: boolean } => ({
    stage: id,
    title: TITLES[id],
    queue: transcriptsPending,
    inflight: transcriptsProcessing,
    failed,
    lastRunAt: embedLastRunAt,
    lastError: embedLastErr,
    folded: true,
  })

  const stages: (StageHealth & { folded?: boolean })[] = [
    {
      stage: 'fetch',
      title: TITLES.fetch,
      queue: channelsPending,
      inflight: fetchInflight,
      failed: fetchFailed,
      lastRunAt: lastFetch?.completed_at ?? null,
      lastError: lastFetch?.error_message ?? null,
    },
    {
      stage: 'transcribe',
      title: TITLES.transcribe,
      queue: videosPending,
      inflight: videosProcessing,
      failed: videosFailed,
      lastRunAt: lastTranscribe?.completed_at ?? null,
      lastError: lastTranscribe?.error_message ?? null,
    },
    folded('clean', tags.clean),
    folded('chunk', tags.chunk),
    {
      stage: 'embed',
      title: TITLES.embed,
      queue: transcriptsPending,
      inflight: transcriptsProcessing,
      failed: transcriptsFailed,
      lastRunAt: embedLastRunAt,
      lastError: embedLastErr,
    },
  ]

  return { now: new Date().toISOString(), stages }
}
