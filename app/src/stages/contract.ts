// Personas v2 — the uniform contract every pipeline stage implements.
//
// The whole point of v2 is that the 6 logical stages stop hiding inside shared
// functions and shared status columns. Each stage is a self-contained module
// that (a) consumes rows in a known input state, (b) advances them, and (c)
// ALWAYS writes a stage-tagged telemetry row so the monitor can see its
// heartbeat, throughput, and last error independently of every other stage.
//
// See docs/PERSONAS-V2-RESTRUCTURE.md for the full design + migration plan.
import type { Env } from '../types'
import { getDb } from '../lib/supabase'

// The five processing stages + chat. Order here IS the pipeline order
// (fetch → transcribe → clean → chunk → embed), so a registry can iterate it.
export type StageId = 'fetch' | 'transcribe' | 'clean' | 'chunk' | 'embed' | 'chat'

export const STAGE_ORDER: StageId[] = ['fetch', 'transcribe', 'clean', 'chunk', 'embed']

export interface StageError {
  ref: string // the row this failed on (video_id / transcript_id / chunk id)
  message: string
}

// What one bounded run of a stage did. Returned to callers AND persisted as a
// pipeline_jobs row (job_type = `stage:<id>`) via writeStageJob().
export interface StageRunResult {
  stage: StageId
  startedAt: string
  finishedAt: string
  seen: number // candidate rows found in this stage's input state
  advanced: number // rows successfully moved to the next state
  failed: number
  errors: StageError[]
}

// Cheap, read-only snapshot for the monitor (GET /api/pipeline).
export interface StageHealth {
  stage: StageId
  title: string
  queue: number // rows waiting in input state
  inflight: number // rows currently 'processing'
  failed: number // rows in a failed state
  lastRunAt: string | null
  lastError: string | null
}

export interface StageRunOpts {
  limit?: number
  channelId?: string
}

export interface Stage {
  id: StageId
  title: string
  run(env: Env, opts?: StageRunOpts): Promise<StageRunResult>
  health(env: Env): Promise<StageHealth>
}

// ---- Shared helpers ------------------------------------------------------

export const nowIso = () => new Date().toISOString()

// Begin a stage run: returns a mutable result + a finisher. The finisher writes
// the stage-tagged pipeline_jobs row so EVERY stage reports uniformly. A stage
// is 'failed' only when it saw work but advanced none of it (pure failure);
// partial progress is 'completed' with errors recorded.
export function startStageRun(stage: StageId) {
  const startedAt = nowIso()
  const result: StageRunResult = { stage, startedAt, finishedAt: '', seen: 0, advanced: 0, failed: 0, errors: [] }

  async function finish(env: Env): Promise<StageRunResult> {
    result.finishedAt = nowIso()
    result.failed = result.errors.length
    const status = result.seen > 0 && result.advanced === 0 ? 'failed' : 'completed'
    try {
      await getDb(env)
        .from('pipeline_jobs')
        .insert({
          job_type: `stage:${stage}`,
          status,
          input_params: {},
          output_stats: {
            seen: result.seen,
            advanced: result.advanced,
            failed: result.failed,
            error_messages: result.errors.slice(0, 10),
          },
          error_message: result.errors[0]?.message ?? null,
          started_at: startedAt,
          completed_at: result.finishedAt,
        })
    } catch (e) {
      // Telemetry must never break the stage itself.
      console.error(`[stage:${stage}] telemetry insert failed`, e)
    }
    return result
  }

  return { result, finish }
}

// Most-recent stage:<id> run, for StageHealth.lastRunAt / lastError.
export async function lastStageRun(env: Env, stage: StageId) {
  const { data } = await getDb(env)
    .from('pipeline_jobs')
    .select('status, error_message, completed_at, output_stats')
    .eq('job_type', `stage:${stage}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as
    | { status: string; error_message: string | null; completed_at: string | null; output_stats: any }
    | null
}
