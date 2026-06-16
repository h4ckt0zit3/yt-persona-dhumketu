// RAG Chat — the persona runtime.
// One entry point that takes a conversation, retrieves the creator's most
// relevant chunks (pgvector cosine, scoped to the channel), grounds the last
// user turn, and streams the persona's reply. Keeps rag + llm wiring in one
// place so the /api/chat route stays a thin adapter.
import type { Env, ChatMessage } from '../types'
import { getDb } from '../lib/supabase'
import { retrieve, buildPersonaSystem, buildUserTurn } from '../lib/rag'
import { streamChat } from '../lib/llm'

export type PersonaChatResult =
  | { ok: true; stream: Awaited<ReturnType<typeof streamChat>> }
  | { ok: false; status: 400 | 404; error: string }

export async function personaChat(
  env: Env,
  channelId: string,
  messages: ChatMessage[],
): Promise<PersonaChatResult> {
  if (!channelId || !messages?.length) {
    return { ok: false, status: 400, error: 'channel_id and messages required' }
  }

  const { data: persona } = await getDb(env)
    .from('personas')
    .select('persona_name, system_prompt')
    .eq('channel_id', channelId)
    .eq('status', 'active')
    .maybeSingle()
  if (!persona) return { ok: false, status: 404, error: 'persona not found or not active' }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const chunks = await retrieve(env, channelId, lastUser?.content ?? '', 10)
  const augmented: ChatMessage[] = messages.map((m, i) =>
    i === messages.length - 1 && m.role === 'user'
      ? { role: 'user', content: buildUserTurn(m.content, chunks) }
      : m,
  )

  const stream = await streamChat(env, {
    system: buildPersonaSystem(persona.system_prompt || `You are ${persona.persona_name}.`),
    messages: augmented,
  })
  return { ok: true, stream }
}
