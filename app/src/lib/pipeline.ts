// Orchestration only. The per-stage work now lives in src/stages/* (fetch,
// transcribe, clean/chunk/embed, persona). This file owns the cross-stage
// concerns: dispatching finished Apify runs to the right handler, the Cron
// poller that closes runs whose webhook never arrived, stuck-job timeouts, and
// job cancellation. See docs/PERSONAS-V2-RESTRUCTURE.md.
import type { Env } from '../types'
import { getDb } from './supabase'
import { getRunStatus } from './apify'
import { failJob, finishJob } from '../stages/jobs'
import { handleVideoDataset } from '../stages/fetch'
import { handleTranscriptDataset } from '../stages/transcribe'

// ---- Guards (pure, unit-tested) -----------------------------------------

// Live scraping is disabled in local dev: there's no public webhook for Apify
// to call back and Miniflare doesn't fire the Cron, so a real (paid) run would
// succeed but its job would never close -> orphaned 'running' forever. Callers
// steer the user to the offline demo path instead.
export function liveScrapeDisabled(env: Env): boolean {
  return env.DEV_AUTH === 'true'
}

// True when a job that started at `startedAt` has been running longer than the
// allowed budget. Null/invalid timestamps are treated as not-expired (we can't
// prove staleness, so we don't fail it on a guess).
export function jobAgeExceeded(startedAt: string | null | undefined, nowMs: number, maxAgeMin: number): boolean {
  if (!startedAt) return false
  const started = new Date(startedAt).getTime()
  if (Number.isNaN(started)) return false
  return nowMs - started > maxAgeMin * 60_000
}

export const SCRAPE_DISABLED_MESSAGE =
  'Live scraping is disabled in local dev (no public webhook + no Cron to finish the job, ' +
  'so a real Apify run would orphan its job). Use Explore → "Load repo + demo channel" → ' +
  '"Embed now" → "Build persona" for the fully-offline path.'

// ---- Dispatch a finished run to its stage handler -----------------------

export async function processFinishedJob(env: Env, jobId: string) {
  const db = getDb(env)
  // Atomically CLAIM the job: flip 'running' -> 'processing' and read it back in
  // one statement. Only the caller whose UPDATE actually matched the row
  // proceeds. The Apify webhook and the 2-min Cron poll can both fire on the same
  // finished run; without this, both would run the handler — and for a
  // video_extraction with chain=true that means TWO paid Apify transcript runs.
  const { data: claimed } = await db
    .from('pipeline_jobs')
    .update({ status: 'processing' })
    .eq('id', jobId)
    .eq('status', 'running')
    .select('id, job_type, channel_id, apify_dataset_id')
  const job = claimed?.[0]
  if (!job) return // not found, or already claimed/closed by another invocation
  try {
    if (job.job_type === 'video_extraction') {
      await handleVideoDataset(env, job.id, job.apify_dataset_id, job.channel_id)
    } else if (job.job_type === 'transcript_extraction') {
      await handleTranscriptDataset(env, job.id, job.apify_dataset_id, job.channel_id)
    } else {
      // No handler for this type — close it so the claim can't orphan it.
      await finishJob(env, job.id, { note: `no handler for job_type=${job.job_type}` })
    }
  } catch (e: any) {
    await failJob(env, jobId, e?.message ?? String(e))
  }
}

// Cron fallback: check Apify status for still-running jobs.
// Writes a cron_apify_poll pipeline_jobs row each tick for /api/cron-health.
export async function pollRunningJobs(env: Env) {
  const db = getDb(env)
  const startedAt = new Date().toISOString()
  const nowMs = Date.now()
  const maxAgeMin = parseInt(env.MAX_JOB_AGE_MIN || '15', 10)
  const { data: jobs } = await db
    .from('pipeline_jobs')
    .select('id, apify_run_id, started_at')
    .eq('status', 'running')
    .not('apify_run_id', 'is', null)
    .limit(20)

  let advanced = 0
  let failed = 0
  let timedOut = 0
  const errors: { job_id: string; message: string }[] = []
  for (const job of jobs ?? []) {
    let status: string
    try {
      status = await getRunStatus(env, job.apify_run_id)
    } catch (e) {
      // Apify status unreachable (run expired/deleted, token issue). If the job
      // is also past its age budget, stop re-polling it forever — fail it.
      if (jobAgeExceeded(job.started_at, nowMs, maxAgeMin)) {
        await failJob(env, job.id, `timed out after ${maxAgeMin}m; Apify status unreachable`)
        timedOut++
      } else {
        errors.push({ job_id: job.id, message: ((e as Error)?.message ?? String(e)).slice(0, 300) })
      }
      continue
    }
    if (status === 'SUCCEEDED') {
      await processFinishedJob(env, job.id)
      advanced++
    } else if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      await failJob(env, job.id, `Apify run ${status}`)
      failed++
    } else if (jobAgeExceeded(job.started_at, nowMs, maxAgeMin)) {
      // Still 'RUNNING' on Apify but past our budget — treat as stuck.
      await failJob(env, job.id, `timed out after ${maxAgeMin}m (Apify still ${status})`)
      timedOut++
    }
  }

  // Sweep jobs stuck mid-handling. processFinishedJob claims a finished run by
  // flipping it to 'processing' before running the handler; if the isolate dies
  // there (not a catchable throw), the loop above — which only re-checks
  // 'running' jobs — would never see it again. Fail any past the age budget.
  const { data: processing } = await db
    .from('pipeline_jobs')
    .select('id, started_at')
    .eq('status', 'processing')
    .limit(20)
  for (const job of processing ?? []) {
    if (jobAgeExceeded(job.started_at, nowMs, maxAgeMin)) {
      await failJob(env, job.id, `timed out after ${maxAgeMin}m mid-processing`)
      timedOut++
    }
  }

  await db.from('pipeline_jobs').insert({
    job_type: 'cron_apify_poll',
    status: errors.length > 0 && advanced === 0 && failed === 0 && timedOut === 0 ? 'failed' : 'completed',
    input_params: {},
    output_stats: {
      polled: jobs?.length ?? 0,
      advanced,
      failed,
      timed_out: timedOut,
      errors: errors.length,
      error_messages: errors,
    },
    error_message: errors[0]?.message ?? null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  })
}

// Cancel one job (the "Resolve"/Cancel button). Only a still-running job can be
// cancelled; everything else is a no-op the caller surfaces as 404/409.
export async function cancelJob(
  env: Env,
  jobId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const db = getDb(env)
  const { data: job } = await db
    .from('pipeline_jobs')
    .select('id, status')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return { status: 404, body: { error: 'job not found' } }
  if (job.status !== 'running') {
    return { status: 409, body: { error: `job is '${job.status}', not running`, status_was: job.status } }
  }
  await failJob(env, jobId, 'cancelled by user')
  return { status: 200, body: { ok: true, cancelled: jobId } }
}
