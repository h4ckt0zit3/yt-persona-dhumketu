import type { Env } from '../types'
import { embedQuery } from './embed'
import { getDb, vecLiteral } from './supabase'

export interface RetrievedChunk {
  chunk_text: string
  video_id: string
  similarity: number
}

// Retrieve the most relevant transcript chunks for a creator using the
// existing Supabase pgvector function search_persona_knowledge() (cosine,
// scoped to one channel_id).
export async function retrieve(
  env: Env,
  channelId: string,
  query: string,
  topK = 10,
): Promise<RetrievedChunk[]> {
  const qvec = await embedQuery(env, query)
  const db = getDb(env)
  const { data, error } = await db.rpc('search_persona_knowledge', {
    query_embedding: vecLiteral(qvec),
    target_channel_id: channelId,
    match_count: topK,
    similarity_threshold: 0.5,
  })
  if (error) throw new Error(`search_persona_knowledge failed: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    chunk_text: r.chunk_text,
    video_id: r.video_id,
    similarity: r.similarity,
  }))
}

export function buildPersonaSystem(personaPrompt: string): string {
  return `${personaPrompt}

GROUNDING RULES:
- Answer using ONLY the excerpts from your own videos provided in the user's message under <context>.
- Stay completely in character — voice, vocabulary, and opinions from your content.
- If the context doesn't cover the question, say so in your own voice instead of inventing facts.
- Never mention "context", "excerpts", "transcripts", or that you are an AI.`
}

export function buildUserTurn(question: string, chunks: RetrievedChunk[]): string {
  const context = chunks.map((c, i) => `[${i + 1}] ${c.chunk_text}`).join('\n\n')
  return `<context>\n${context || '(no relevant material found)'}\n</context>\n\nQuestion: ${question}`
}
