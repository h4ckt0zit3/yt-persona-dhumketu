import { describe, expect, it } from 'vitest'
import { channelColor, channelInitials } from '../web/src/lib/persona'

describe('channelColor', () => {
  it('returns a hex string for any id', () => {
    expect(channelColor('CH0001')).toMatch(/^#[0-9A-F]{6}$/i)
    expect(channelColor('lex-fridman')).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('is deterministic for the same id', () => {
    expect(channelColor('CH0001')).toBe(channelColor('CH0001'))
    expect(channelColor('huberman')).toBe(channelColor('huberman'))
  })

  it('different ids may map to different colors', () => {
    const colors = new Set([
      channelColor('a'),
      channelColor('b'),
      channelColor('c'),
      channelColor('d'),
      channelColor('e'),
      channelColor('f'),
    ])
    // With 6 ids and 6 palette slots, we should see at least 3 distinct values.
    expect(colors.size).toBeGreaterThanOrEqual(3)
  })

  it('returns a default color for null/undefined/empty', () => {
    expect(channelColor(null)).toMatch(/^#[0-9A-F]{6}$/i)
    expect(channelColor(undefined)).toMatch(/^#[0-9A-F]{6}$/i)
    expect(channelColor('')).toMatch(/^#[0-9A-F]{6}$/i)
  })
})

describe('channelInitials', () => {
  it('extracts first letter of each of the first two words, uppercased', () => {
    expect(channelInitials('Lex Fridman')).toBe('LF')
    expect(channelInitials('Huberman Lab')).toBe('HL')
    expect(channelInitials('Joe Rogan Experience')).toBe('JR')
  })

  it('uses first two characters of a single word', () => {
    expect(channelInitials('Veritasium')).toBe('VE')
    expect(channelInitials('Acquired')).toBe('AC')
  })

  it('falls back to id when name is missing', () => {
    expect(channelInitials(null, 'CH9001')).toBe('CH')
    expect(channelInitials(undefined, 'lex')).toBe('LE')
  })

  it('returns ?? sentinel when nothing is provided', () => {
    expect(channelInitials(null)).toBe('??')
    expect(channelInitials(undefined)).toBe('??')
    expect(channelInitials('')).toBe('??')
  })

  it('uppercases', () => {
    expect(channelInitials('joe rogan')).toBe('JR')
  })

  it('handles extra whitespace', () => {
    expect(channelInitials('  Lex   Fridman  ')).toBe('LF')
  })
})
