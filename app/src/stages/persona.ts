// Phase 6 — Persona assembly.
// Reads a channel's embedded chunks, has the LLM reverse-engineer the creator's
// voice/frameworks into a system prompt + style profile, and activates the
// persona row. Separate from the RAG chat runtime (stages/chat.ts).
import type { Env } from '../types'
import { getDb } from '../lib/supabase'
import { completeChat } from '../lib/llm'
import { AppError } from '../lib/errors'

interface EmbeddingRow {
  chunk_text: string
}

const ANALYST_SYSTEM = `You are an expert at reverse-engineering a content creator's voice and expertise from transcripts of their own videos. Output ONLY valid minified JSON, no markdown, matching exactly this shape:
{"system_prompt":"a second-person instruction block that makes an LLM speak AS this creator (identity, expertise, tone, signature phrases, how they explain things)","style_profile":{"formality":0.0,"humor":0.0,"technical_depth":0.0,"storytelling":0.0,"directness":0.0,"vocabulary_level":"","common_phrases":[],"teaching_style":""},"top_topics":[],"expertise_areas":[]}
Numbers are 0.0-1.0. Base everything strictly on the transcripts; do not invent biography.`

export async function buildPersona(env: Env, channelId: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb(env)
  const { data: channel } = await db
    .from('channels')
    .select('channel_id, niche_id, channel_name')
    .eq('channel_id', channelId)
    .maybeSingle()
  if (!channel) return { ok: false, error: 'channel not found' }

  const sampleRes = (await db
    .from('embeddings')
    .select('chunk_text')
    .eq('channel_id', channelId)
    .order('chunk_index', { ascending: true })
    .limit(40)) as { data: EmbeddingRow[] | null; error: any }
  const sample: EmbeddingRow[] | null = sampleRes.data
  if (!sample || sample.length === 0)
    return { ok: false, error: 'no embedded transcripts yet — ingest + wait for embeddings first' }

  await db.from('personas').upsert(
    { channel_id: channelId, persona_name: channel.channel_name, niche_id: channel.niche_id, status: 'building' },
    { onConflict: 'channel_id' },
  )

  const sampleText = sample.map((r: EmbeddingRow) => r.chunk_text).join('\n---\n').slice(0, 24000)

  let parsed: any
  try {
    const raw = await completeChat(env, {
      system: ANALYST_SYSTEM,
      messages: [{ role: 'user', content: `Creator: ${channel.channel_name}\n\nTranscript excerpts:\n${sampleText}` }],
      maxTokens: 1500,
      temperature: 0.4,
    })
    try {
      parsed = JSON.parse(extractJson(raw))
    } catch (parseErr) {
      throw new AppError('persona_parse_failed', 'LLM returned invalid JSON for persona analysis', {
        retryable: true,
        context: { sample: raw.slice(0, 200) },
        cause: parseErr,
      })
    }
  } catch (e: any) {
    await db.from('personas').update({ status: 'draft' }).eq('channel_id', channelId)
    return { ok: false, error: `persona analysis failed: ${e?.message ?? e}` }
  }

  const stats = await gatherStats(env, channelId)
  await db
    .from('personas')
    .update({
      system_prompt: parsed.system_prompt ?? '',
      style_profile: parsed.style_profile ?? {},
      knowledge_stats: { ...stats, top_topics: parsed.top_topics ?? [], expertise_areas: parsed.expertise_areas ?? [] },
      status: 'active',
    })
    .eq('channel_id', channelId)
  return { ok: true }
}

async function gatherStats(env: Env, channelId: string) {
  const db = getDb(env)
  const { count: videos } = await db
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .eq('has_transcript', true)
  const { count: chunks } = await db
    .from('embeddings')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', channelId)
  return { total_videos_processed: videos ?? 0, total_chunks: chunks ?? 0 }
}

function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end !== -1) return s.slice(start, end + 1)
  return s
}
