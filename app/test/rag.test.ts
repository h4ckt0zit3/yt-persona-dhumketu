import { describe, expect, it } from 'vitest'
import { buildPersonaSystem, buildUserTurn, type RetrievedChunk } from '../src/lib/rag'

describe('buildPersonaSystem', () => {
  it('prefixes the persona prompt and appends grounding rules', () => {
    const out = buildPersonaSystem('You are Lex.')
    expect(out.startsWith('You are Lex.')).toBe(true)
    expect(out).toContain('GROUNDING RULES')
    expect(out).toContain('ONLY the excerpts')
    expect(out).toContain('Never mention "context"')
  })

  it('preserves the persona prompt verbatim', () => {
    const prompt = 'You are a very specific creator with unique traits.\nMultiline.'
    expect(buildPersonaSystem(prompt)).toContain(prompt)
  })
})

describe('buildUserTurn', () => {
  it('embeds chunks numbered starting at 1', () => {
    const chunks: RetrievedChunk[] = [
      { chunk_text: 'first', video_id: 'v1', similarity: 0.9 },
      { chunk_text: 'second', video_id: 'v2', similarity: 0.8 },
    ]
    const out = buildUserTurn('What?', chunks)
    expect(out).toContain('[1] first')
    expect(out).toContain('[2] second')
    expect(out).toContain('Question: What?')
  })

  it('wraps context in <context> tags', () => {
    const out = buildUserTurn('Q', [{ chunk_text: 'x', video_id: 'v', similarity: 1 }])
    expect(out).toMatch(/<context>[\s\S]*<\/context>/)
  })

  it('falls back to "no relevant material" when no chunks', () => {
    const out = buildUserTurn('Q', [])
    expect(out).toContain('(no relevant material found)')
    expect(out).toContain('Question: Q')
  })

  it('preserves the question text verbatim', () => {
    const q = 'How does X relate to Y, exactly?'
    expect(buildUserTurn(q, [])).toContain(`Question: ${q}`)
  })
})
