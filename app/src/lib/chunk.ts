// Semantic chunking ported from pipeline/n8n/workflows-spec.md.
// Sentence-boundary aware, target ~500 tokens, 100-token overlap,
// min 200 tokens before forcing a split.
export function semanticChunk(text: string, targetTokens = 500, overlap = 100): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  // Sentence-aware split. The second alternative ([^.!?]+$) captures a trailing
  // run that has no terminal punctuation — critical for YouTube auto-captions,
  // which often have NO punctuation at all. (A bare \S+$ here would match only
  // the final word and silently drop the rest of an unpunctuated transcript.)
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean]
  const chunks: string[] = []
  let current: string[] = []
  let currentTokens = 0

  const tok = (s: string) => Math.ceil(s.split(/\s+/).length * 1.3)

  for (const sentence of sentences) {
    const sTokens = tok(sentence)
    if (currentTokens + sTokens > targetTokens * 1.2 && currentTokens > 200) {
      chunks.push(current.join(' '))
      // build overlap tail
      const tail: string[] = []
      let tailTokens = 0
      for (let i = current.length - 1; i >= 0; i--) {
        const st = tok(current[i])
        if (tailTokens + st > overlap) break
        tail.unshift(current[i])
        tailTokens += st
      }
      current = tail
      currentTokens = tailTokens
    }
    current.push(sentence.trim())
    currentTokens += sTokens
  }
  if (current.length > 0) chunks.push(current.join(' '))
  return chunks.map((c) => c.trim()).filter(Boolean)
}

export function estimateTokens(s: string): number {
  return Math.ceil(s.split(/\s+/).length * 1.3)
}
