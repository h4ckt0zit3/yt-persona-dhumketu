import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { toInt } from '../src/lib/csv'

describe('toInt', () => {
  it('returns null for empty/nullish input', () => {
    expect(toInt('')).toBeNull()
    expect(toInt(undefined)).toBeNull()
    expect(toInt(null)).toBeNull()
  })

  it('strips non-numeric chars (commas, currency)', () => {
    expect(toInt('1,234,567')).toBe(1234567)
    expect(toInt('$42')).toBe(42)
    expect(toInt('5K')).toBe(5)
  })

  it('preserves leading minus', () => {
    expect(toInt('-42')).toBe(-42)
  })

  it('returns null for non-numeric garbage', () => {
    expect(toInt('abc')).toBeNull()
  })
})

// Regression suite: today's "imported 0 channels" bug was a custom parser that
// silently dropped rows with commas inside quoted fields. Papaparse handles it.
// These tests pin the parser behavior the import handlers depend on.
describe('papaparse integration (CSV import contract)', () => {
  const parse = (text: string) =>
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      transform: (v) => (typeof v === 'string' ? v.trim() : v),
    }).data

  it('parses simple 2-column 1-row file', () => {
    const rows = parse('niche_id,niche\nN001,Science')
    expect(rows).toEqual([{ niche_id: 'N001', niche: 'Science' }])
  })

  it('REGRESSION: handles quoted field with embedded commas (the bug today)', () => {
    const rows = parse(
      'channel_id,channel_url,description\nCH9001,https://yt/x,"Visual science by Derek, with commas, inside"',
    )
    expect(rows[0]).toEqual({
      channel_id: 'CH9001',
      channel_url: 'https://yt/x',
      description: 'Visual science by Derek, with commas, inside',
    })
  })

  it('handles escaped double quotes inside quoted fields', () => {
    const rows = parse('a,b\nfoo,"she said ""hi"" loudly"')
    expect(rows[0].b).toBe('she said "hi" loudly')
  })

  it('handles \\r\\n line endings (Windows)', () => {
    const rows = parse('a,b\r\n1,2\r\n3,4')
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })

  it('skips blank lines', () => {
    const rows = parse('a,b\n1,2\n\n3,4\n')
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })

  it('trims header whitespace', () => {
    const rows = parse('  a  ,  b  \n1,2')
    expect(rows[0]).toEqual({ a: '1', b: '2' })
  })

  it('trims value whitespace', () => {
    const rows = parse('a,b\n  1  ,  2  ')
    expect(rows[0]).toEqual({ a: '1', b: '2' })
  })

  it('returns empty array for header-only file', () => {
    expect(parse('a,b\n')).toEqual([])
  })

  it('handles many rows', () => {
    const lines = ['a,b']
    for (let i = 0; i < 100; i++) lines.push(`${i},${i * 2}`)
    const rows = parse(lines.join('\n'))
    expect(rows).toHaveLength(100)
    expect(rows[99]).toEqual({ a: '99', b: '198' })
  })

  it('handles UTF-8 with em dashes (matches our test CSV)', () => {
    const rows = parse('a,b\nfoo,"Visual science by Derek Muller — physics, engineering"')
    expect(rows[0].b).toBe('Visual science by Derek Muller — physics, engineering')
  })
})
