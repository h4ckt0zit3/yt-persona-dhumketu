import { describe, expect, it } from 'vitest'
import { semanticChunk, estimateTokens } from '../src/lib/chunk'

describe('estimateTokens', () => {
  it('returns 0-ish for empty string', () => {
    expect(estimateTokens('')).toBeLessThanOrEqual(2)
  })

  it('scales roughly 1.3x word count', () => {
    expect(estimateTokens('one two three four five')).toBe(7) // ceil(5 * 1.3) = 7
  })
})

describe('semanticChunk', () => {
  it('returns empty array for empty or whitespace input', () => {
    expect(semanticChunk('')).toEqual([])
    expect(semanticChunk('   \n  ')).toEqual([])
  })

  it('returns single chunk for short text', () => {
    const out = semanticChunk('Hello world. This is short.')
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('Hello world')
  })

  it('splits long text into multiple chunks when over target', () => {
    const long = 'A long sentence ending here. '.repeat(80)
    const out = semanticChunk(long, 100, 20)
    expect(out.length).toBeGreaterThan(1)
  })

  it('respects targetTokens parameter', () => {
    const text = ('This sentence has eight more words to count. '.repeat(40)).trim()
    const small = semanticChunk(text, 100, 20)
    const big = semanticChunk(text, 1000, 200)
    expect(small.length).toBeGreaterThan(big.length)
  })

  it('preserves all content (no dropped words)', () => {
    const text = 'First. Second sentence here. Third. Fourth one. Fifth and final.'
    const out = semanticChunk(text)
    const joined = out.join(' ')
    for (const word of ['First', 'Second', 'Third', 'Fourth', 'Fifth']) {
      expect(joined).toContain(word)
    }
  })

  it('handles text without sentence punctuation', () => {
    const text = 'word '.repeat(300).trim()
    const out = semanticChunk(text)
    expect(out.length).toBeGreaterThanOrEqual(1)
  })

  it('preserves content when there is NO sentence punctuation (auto-captions)', () => {
    // Distinct words so dropped content is detectable (the repeated-"word"
    // case above cannot catch silent loss). Regression for the bug where an
    // unpunctuated transcript collapsed to just its final word.
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`)
    const out = semanticChunk(words.join(' '))
    const joined = out.join(' ')
    expect(joined).toContain('w0')
    expect(joined).toContain('w100')
    expect(joined).toContain('w199')
    const recovered = joined.split(/\s+/).filter(Boolean).length
    expect(recovered).toBeGreaterThanOrEqual(words.length) // no words dropped (overlap may add some)
  })
})
