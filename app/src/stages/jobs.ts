// Shared pipeline_jobs bookkeeping. Lives on its own so both the stage modules
// (fetch/transcribe) and the orchestrator (lib/pipeline) can use it without a
// circular import.
import type { Env } from '../types'
import { getDb } from '../lib/supabase'

export const nowIso = () => new Date().toISOString()

export async function finishJob(env: Env, jobId: string, stats: object) {
  await getDb(env)
    .from('pipeline_jobs')
    .update({ status: 'completed', output_stats: stats, completed_at: nowIso() })
    .eq('id', jobId)
}

export async function failJob(env: Env, jobId: string, message: string) {
  await getDb(env)
    .from('pipeline_jobs')
    .update({ status: 'failed', error_message: message.slice(0, 1000), completed_at: nowIso() })
    .eq('id', jobId)
}
