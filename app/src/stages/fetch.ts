// Stage 1 — Fetch videos.
// Starts an Apify run for a channel's long-form videos, then (on dataset
// arrival) filters Shorts, stores videos as transcript_status='pending', and
// optionally auto-chains into Stage 2.
import type { Env } from '../types'
import { getDb } from '../lib/supabase'
import { startActorRun, getDatasetItems, mapVideo } from '../lib/apify'
import { finishJob, nowIso } from './jobs'
import { startTranscriptExtraction, type ChannelRow } from './transcribe'

export async function startVideoExtraction(env: Env, channel: ChannelRow, chain = false): Promise<string> {
  const max = parseInt(env.MAX_VIDEOS_PER_CHANNEL || '50', 10)
  const input = {
    startUrls: [{ url: channel.channel_url }],
    maxResults: max,
    maxResultStreams: 0,
    maxResultsShorts: 0,
    proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  }
  const jobId = crypto.randomUUID()
  const run = await startActorRun(env, env.APIFY_VIDEO_ACTOR, input, '/api/webhooks/apify', jobId)
  await getDb(env).from('pipeline_jobs').insert({
    id: jobId,
    job_type: 'video_extraction',
    status: 'running',
    channel_id: channel.channel_id,
    apify_run_id: run.runId,
    apify_dataset_id: run.datasetId,
    input_params: { chain },
    started_at: nowIso(),
  })
  return jobId
}

export async function handleVideoDataset(env: Env, jobId: string, datasetId: string, channelId: string) {
  const db = getDb(env)
  const { data: channel } = await db
    .from('channels')
    .select('channel_id, niche_id, channel_name, channel_url')
    .eq('channel_id', channelId)
    .maybeSingle()
  const nicheId = channel?.niche_id ?? null

  const items = await getDatasetItems(env, datasetId)
  const max = parseInt(env.MAX_VIDEOS_PER_CHANNEL || '50', 10)

  const mapped = items
    .map(mapVideo)
    .filter((v): v is NonNullable<typeof v> => v !== null)
    // Format filter: exclude Shorts (<60s). Keep unknown-duration videos.
    .filter((v) => v.duration_seconds === null || v.duration_seconds >= 60)
    .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))
    .slice(0, max)

  if (mapped.length > 0) {
    const rows = mapped.map((v) => ({
      video_id: v.video_id,
      channel_id: channelId,
      niche_id: nicheId,
      video_title: v.video_title,
      video_url: v.video_url,
      published_date: v.published_date,
      duration_seconds: v.duration_seconds,
      view_count: v.view_count,
      like_count: v.like_count,
      comment_count: v.comment_count,
      last_scraped: nowIso(),
    }))
    // Check the error: a bad row (e.g. an unparseable date) would otherwise fail
    // the whole batch silently, leaving the job "succeeded" with 0 videos stored.
    const { error } = await db.from('videos').upsert(rows, { onConflict: 'video_id' })
    if (error) throw new Error(`videos upsert failed: ${error.message}`)
  }

  // NOTE: do not write total_videos here — `mapped.length` is the capped scrape
  // count (≤ MAX_VIDEOS_PER_CHANNEL), not the channel's real video total, and
  // would clobber the imported value. The scraped count lives in the job's
  // output_stats below; the UI derives video_count from the videos table.
  await db
    .from('channels')
    .update({ status: 'active', last_scraped: nowIso() })
    .eq('channel_id', channelId)

  await finishJob(env, jobId, { videos_inserted: mapped.length, raw_items: items.length })

  // Auto-chain into transcripts if launched via "ingest all".
  const { data: job } = await db.from('pipeline_jobs').select('input_params').eq('id', jobId).maybeSingle()
  if (job?.input_params?.chain && channel && mapped.length > 0) {
    try {
      await startTranscriptExtraction(env, channel as ChannelRow)
    } catch (e) {
      console.error('auto transcript chain failed', e)
    }
  }
}
