// Stage 2 — Transcribe & save.
// Pulls captions for a channel's pending videos via Apify, applies the safe
// minimalClean pass, and stores transcripts (embedding_status='pending', the
// hand-off to the clean→chunk→embed pipeline).
import type { Env } from '../types'
import { getDb } from '../lib/supabase'
import { startActorRun, getDatasetItems, mapTranscript } from '../lib/apify'
import { minimalClean } from '../lib/clean'
import { finishJob, nowIso } from './jobs'

// Shared row shapes for stages 1–2 (defined here because fetch.ts imports
// transcribe.ts for the auto-chain, so this is the cycle-free home).
export interface ChannelRow {
  channel_id: string
  niche_id: string | null
  channel_name: string
  channel_url: string
}

export interface VideoRow {
  video_id: string
  video_url: string
}

export async function startTranscriptExtraction(
  env: Env,
  channel: ChannelRow,
): Promise<{ jobId: string; count: number }> {
  const db = getDb(env)
  const pendingRes = (await db
    .from('videos')
    .select('video_id, video_url')
    .eq('channel_id', channel.channel_id)
    .eq('transcript_status', 'pending')
    .limit(parseInt(env.MAX_VIDEOS_PER_CHANNEL || '50', 10))) as { data: VideoRow[] | null; error: any }
  const pending: VideoRow[] | null = pendingRes.data
  if (!pending || pending.length === 0) return { jobId: '', count: 0 }

  const urls: string[] = pending.map((v: VideoRow) => v.video_url)
  const input = {
    startUrls: urls.map((url) => ({ url })),
    videoUrls: urls,
    language: 'en',
    proxy: { useApifyProxy: true },
  }
  const jobId = crypto.randomUUID()
  const run = await startActorRun(env, env.APIFY_TRANSCRIPT_ACTOR, input, '/api/webhooks/apify', jobId)

  await db.from('pipeline_jobs').insert({
    id: jobId,
    job_type: 'transcript_extraction',
    status: 'running',
    channel_id: channel.channel_id,
    apify_run_id: run.runId,
    apify_dataset_id: run.datasetId,
    input_params: { count: urls.length, video_ids: pending.map((v: VideoRow) => v.video_id) },
    started_at: nowIso(),
  })

  await db
    .from('videos')
    .update({ transcript_status: 'processing' })
    .in('video_id', pending.map((v: VideoRow) => v.video_id))

  return { jobId, count: urls.length }
}

export async function handleTranscriptDataset(env: Env, jobId: string, datasetId: string, channelId: string) {
  const db = getDb(env)
  const { data: channel } = await db.from('channels').select('niche_id').eq('channel_id', channelId).maybeSingle()
  const nicheId = channel?.niche_id ?? null

  const items = await getDatasetItems(env, datasetId)
  let stored = 0
  const storedIds = new Set<string>()

  for (const item of items) {
    const t = mapTranscript(item)
    if (!t) continue

    const cleanedText = minimalClean(t.text)

    await db.from('transcripts').upsert(
      {
        video_id: t.video_id,
        channel_id: channelId,
        niche_id: nicheId,
        language: t.language ?? 'en',
        raw_text: cleanedText,
        word_count: wordCount(cleanedText),
        extraction_method: 'youtube_captions',
        embedding_status: 'pending',
      },
      { onConflict: 'video_id' },
    )
    await db.from('videos').update({ transcript_status: 'completed', has_transcript: true }).eq('video_id', t.video_id)
    storedIds.add(t.video_id)
    stored++
  }

  // Fail ONLY this job's batch members that returned no transcript — scoped via
  // the video_ids recorded on the job. The old channel-wide "mark every
  // 'processing' row failed" wrongly failed videos from other/concurrent runs.
  const { data: job } = await db.from('pipeline_jobs').select('input_params').eq('id', jobId).maybeSingle()
  const batch: string[] = job?.input_params?.video_ids ?? []
  const failedIds = batch.filter((id) => !storedIds.has(id))
  if (failedIds.length > 0) {
    await db.from('videos').update({ transcript_status: 'failed' }).in('video_id', failedIds)
  } else if (batch.length === 0) {
    // Legacy job created before video_ids were tracked: fall back to the old
    // channel-wide sweep so nothing is left stuck in 'processing'.
    await db
      .from('videos')
      .update({ transcript_status: 'failed' })
      .eq('channel_id', channelId)
      .eq('transcript_status', 'processing')
  }

  await finishJob(env, jobId, { transcripts_stored: stored, raw_items: items.length, failed: failedIds.length })
  // Embeddings are produced by the Cron drain (drainPendingEmbeddings).
}

// Word count that reports 0 for empty/whitespace text. ("".split(/\s+/) is
// [""] → length 1, which would otherwise report an empty transcript as 1 word.)
function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}
