import type { Env, EmbedJob } from '../types'
import { getDb, vecLiteral } from './supabase'
import { semanticChunk, estimateTokens } from './chunk'
import { AppError, fromHttpError } from './errors'
import { deepClean, type CleanMetrics } from './clean'

// ---- Embedding generation (provider switch) -----------------------------

// Deterministic offline embedding. Hashes token n-grams into a fixed-width
// vector and L2-normalizes it — no external call, no quota. Vectors aren't
// semantically meaningful, but the whole chunk -> embed -> persona path (which
// reads chunk_text, not the vector) runs end-to-end in dev. RAG retrieval still
// returns rows; relevance is just weaker than a real model.
function localEmbed(text: string, dim: number): number[] {
  const v = new Array(dim).fill(0)
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  for (let i = 0; i < tokens.length; i++) {
    const gram = tokens[i] + (i + 1 < tokens.length ? ' ' + tokens[i + 1] : '')
    let h = 2166136261
    for (let k = 0; k < gram.length; k++) {
      h ^= gram.charCodeAt(k)
      h = Math.imul(h, 16777619)
    }
    const idx = Math.abs(h) % dim
    v[idx] += 1
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  return v.map((x) => x / norm)
}

export async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (env.EMBED_PROVIDER === 'local') {
    const dim = parseInt(env.EMBED_DIM || '1024', 10)
    return texts.map((t) => localEmbed(t, dim))
  }
  if (env.EMBED_PROVIDER === 'openai') {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    })
    if (!res.ok) {
      const code = res.status === 429 ? 'embed_quota' : 'embed_failed'
      throw fromHttpError(code, 'OpenAI embeddings', res.status, await res.text())
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] }
    return json.data.map((d) => d.embedding)
  }
  // Workers AI (free tier). bge-large-en-v1.5 -> 1024 dims.
  try {
    const resp = (await env.AI.run(env.EMBED_MODEL as any, { text: texts })) as unknown as {
      data: number[][]
    }
    return resp.data
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    const looksLikeQuota = /quota|rate.?limit|429|throttle/i.test(msg)
    throw new AppError(
      looksLikeQuota ? 'embed_quota' : 'embed_failed',
      `Workers AI embedding failed: ${msg}`,
      { retryable: true, context: { model: env.EMBED_MODEL }, cause: e },
    )
  }
}

export async function embedQuery(env: Env, query: string): Promise<number[]> {
  const [v] = await embedTexts(env, [query])
  return v
}

// ---- v2: discrete, stage-attributed steps -------------------------------
// The clean → chunk → embed pipeline used to be one opaque function under a
// single status column, so a failure could be any of the three with no way to
// tell which. These named steps each tag their errors with the owning stage
// ('clean' | 'chunk' | 'embed') so failures point at exactly one place. The DB
// state machine is unchanged for now; per-stage status columns land in P5 (see
// docs/PERSONAS-V2-RESTRUCTURE.md).

type EmbedStageId = 'clean' | 'chunk' | 'embed'

// Make an error stage-attributed without losing AppError typing/codes.
function tagStage(stage: EmbedStageId, e: unknown): Error {
  const msg = (e as Error)?.message ?? String(e)
  const tagged = msg.startsWith(`[${stage}]`) ? msg : `[${stage}] ${msg}`
  if (e instanceof AppError) {
    e.message = tagged
    return e
  }
  return new Error(tagged)
}

// Stage 3 — deep clean one transcript's raw text (niche-aware filler/CTA removal).
export function cleanStep(rawText: string, nicheId: string | null): { text: string; metrics: CleanMetrics } {
  try {
    return deepClean(rawText, nicheId)
  } catch (e) {
    throw tagStage('clean', e)
  }
}

// Stage 4 — split cleaned text into sentence-aware ~500-token chunks.
export function chunkStep(cleanedText: string): string[] {
  try {
    return semanticChunk(cleanedText, 500, 100)
  } catch (e) {
    throw tagStage('chunk', e)
  }
}

// ---- Embed one transcript into Supabase pgvector ------------------------
// Orchestrates the three steps for one transcript. Behaviour is identical to
// before; the win is that any throw is now attributed to clean/chunk/embed.

export async function embedTranscript(env: Env, job: EmbedJob): Promise<number> {
  const db = getDb(env)

  const { data: tr } = await db
    .from('transcripts')
    .select('id, raw_text, niche_id')
    .eq('video_id', job.video_id)
    .maybeSingle()
  if (!tr || !tr.raw_text) {
    await db.from('transcripts').update({ embedding_status: 'failed' }).eq('id', job.transcript_id)
    throw new Error(`Transcript text not found for ${job.video_id}`)
  }

  // Stage 3: clean.
  const { text: cleanedText, metrics } = cleanStep(tr.raw_text, tr.niche_id)
  console.log(`[stage:clean] ${job.video_id} reduced ${metrics.reductionPercent}%`)

  // Stage 4: chunk.
  const chunks = chunkStep(cleanedText)
  console.log(`[stage:chunk] ${job.video_id} -> ${chunks.length} chunks`)
  if (chunks.length === 0) {
    await db.from('transcripts').update({ embedding_status: 'completed' }).eq('id', job.transcript_id)
    return 0
  }

  // Stage 5: embed.
  await db.from('transcripts').update({ embedding_status: 'processing' }).eq('id', job.transcript_id)
  // Idempotent re-run: clear prior chunks for this video.
  await db.from('embeddings').delete().eq('video_id', job.video_id)

  let index = 0
  const BATCH = 50
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH)
    let vectors: number[][]
    try {
      vectors = await embedTexts(env, slice)
    } catch (e) {
      // Transient (e.g. Workers AI daily free allowance hit) — leave the
      // transcript 'pending' so the next Cron tick retries it from scratch
      // (the delete above keeps re-runs idempotent) rather than dropping it.
      await db.from('transcripts').update({ embedding_status: 'pending' }).eq('id', job.transcript_id)
      throw tagStage('embed', e)
    }
    const rows = slice.map((text, j) => ({
      transcript_id: job.transcript_id,
      video_id: job.video_id,
      channel_id: job.channel_id,
      niche_id: job.niche_id,
      chunk_index: index++,
      chunk_text: text,
      token_count: estimateTokens(text),
      embedding: vecLiteral(vectors[j]),
    }))
    const { error } = await db.from('embeddings').insert(rows)
    if (error) {
      await db.from('transcripts').update({ embedding_status: 'failed' }).eq('id', job.transcript_id)
      throw tagStage('embed', new Error(`embeddings insert failed: ${error.message}`))
    }
  }

  await db.from('transcripts').update({ embedding_status: 'completed' }).eq('id', job.transcript_id)
  return chunks.length
}

// ---- Synchronous per-channel embed (the "Embed now" button) -------------
// Chunks + embeds every pending transcript for one channel right now and
// returns a per-transcript breakdown so the UI can show exactly what happened
// (and which transcript failed) instead of waiting on the Cron drain.
// Each transcript embed costs several subrequests (DB reads/writes + a
// Workers-AI call per chunk batch), and the Workers free plan caps subrequests
// per request (~50). Processing "all 200 pending" in one click could blow that
// and fail mid-way. Bound it to a small batch; the rest stay 'pending' for the
// next click or the Cron drain. pending_seen is the TRUE pending total so the
// caller can tell how many remain.
const EMBED_NOW_BATCH = 8

export async function embedChannelNow(
  env: Env,
  channelId: string,
): Promise<{
  processed: number
  chunks: number
  pending_seen: number
  remaining: number
  errors: { video_id: string; message: string }[]
}> {
  const db = getDb(env)
  const { count: totalPending } = await db
    .from('transcripts')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .eq('embedding_status', 'pending')

  const { data: pending } = await db
    .from('transcripts')
    .select('id, video_id, channel_id, niche_id')
    .eq('channel_id', channelId)
    .eq('embedding_status', 'pending')
    .limit(EMBED_NOW_BATCH)

  const list = pending ?? []
  let processed = 0
  let chunks = 0
  const errors: { video_id: string; message: string }[] = []
  for (const t of list) {
    try {
      chunks += await embedTranscript(env, {
        transcript_id: t.id,
        video_id: t.video_id,
        channel_id: t.channel_id,
        niche_id: t.niche_id,
      })
      processed++
    } catch (e) {
      errors.push({ video_id: t.video_id, message: ((e as Error)?.message ?? String(e)).slice(0, 300) })
    }
  }
  const pendingSeen = totalPending ?? list.length
  return { processed, chunks, pending_seen: pendingSeen, remaining: Math.max(0, pendingSeen - processed), errors }
}

// ---- Cron drain: embed a few pending transcripts per tick ---------------
// Writes a pipeline_jobs row each tick so the Dashboard can surface
// otherwise-invisible failures (Workers AI quota, model errors, etc.).
// See /api/cron-health.

export async function drainPendingEmbeddings(env: Env, limit = 3): Promise<number> {
  const db = getDb(env)
  const startedAt = new Date().toISOString()
  const { data: pending } = await db
    .from('transcripts')
    .select('id, video_id, channel_id, niche_id')
    .eq('embedding_status', 'pending')
    .limit(limit)

  if (!pending || pending.length === 0) {
    // Still record an "empty" tick so the UI shows the cron is alive.
    await db.from('pipeline_jobs').insert({
      job_type: 'cron_embed_drain',
      status: 'completed',
      input_params: { limit },
      output_stats: { processed: 0, errors: 0, error_messages: [], pending_seen: 0 },
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    })
    return 0
  }

  let done = 0
  const errors: { video_id: string; message: string }[] = []
  for (const t of pending) {
    try {
      await embedTranscript(env, {
        transcript_id: t.id,
        video_id: t.video_id,
        channel_id: t.channel_id,
        niche_id: t.niche_id,
      })
      done++
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      console.error('drain embed failed', t.video_id, e)
      errors.push({ video_id: t.video_id, message: msg.slice(0, 300) })
    }
  }

  await db.from('pipeline_jobs').insert({
    job_type: 'cron_embed_drain',
    status: errors.length === pending.length ? 'failed' : 'completed',
    input_params: { limit },
    output_stats: {
      processed: done,
      errors: errors.length,
      error_messages: errors,
      pending_seen: pending.length,
    },
    error_message: errors[0]?.message ?? null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  })

  return done
}
