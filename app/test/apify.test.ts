import { describe, expect, it, vi } from 'vitest'
import { mapVideo, mapTranscript, startActorRun, getRunStatus, getDatasetItems } from '../src/lib/apify'
import { AppError } from '../src/lib/errors'
import { fakeEnv, mockFetchOnce } from './helpers'

describe('mapVideo', () => {
  it('extracts standard fields from streamers/youtube-scraper output', () => {
    const out = mapVideo({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      date: '2009-10-25',
      duration: 213,
      viewCount: 1500000000,
      likes: 18000000,
      commentsCount: 2000000,
    })
    expect(out).toEqual({
      video_id: 'dQw4w9WgXcQ',
      video_title: 'Never Gonna Give You Up',
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      published_date: '2009-10-25',
      duration_seconds: 213,
      view_count: 1500000000,
      like_count: 18000000,
      comment_count: 2000000,
    })
  })

  it('falls back to alternative field names', () => {
    const out = mapVideo({
      videoUrl: 'https://youtu.be/abcdefghijk',
      videoId: 'abcdefghijk',
      videoTitle: 'Alt schema',
      publishedAt: '2024-01-01',
      durationSeconds: 60,
    })
    expect(out?.video_id).toBe('abcdefghijk')
    expect(out?.video_title).toBe('Alt schema')
  })

  it('returns null when required fields are missing', () => {
    expect(mapVideo({ url: 'x' })).toBeNull()
    expect(mapVideo({})).toBeNull()
    expect(mapVideo({ title: 'x' })).toBeNull()
  })

  it('parses ISO 8601 duration (PT12M3S)', () => {
    const out = mapVideo({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'X',
      duration: 'PT1H2M3S',
    })
    expect(out?.duration_seconds).toBe(3723)
  })

  it('parses MM:SS duration', () => {
    const out = mapVideo({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'X',
      duration: '12:34',
    })
    expect(out?.duration_seconds).toBe(754)
  })

  it('parses HH:MM:SS duration', () => {
    const out = mapVideo({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'X',
      duration: '1:02:03',
    })
    expect(out?.duration_seconds).toBe(3723)
  })

  it('returns null duration for unrecognized format', () => {
    const out = mapVideo({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'X',
      duration: 'about a minute',
    })
    expect(out?.duration_seconds).toBeNull()
  })

  it('extracts video id from a shorts URL', () => {
    const out = mapVideo({
      url: 'https://www.youtube.com/shorts/abcdefghijk',
      title: 'X',
    })
    expect(out?.video_id).toBe('abcdefghijk')
  })

  it('strips commas/letters from numeric fields', () => {
    const out = mapVideo({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'X',
      viewCount: '1,234,567 views',
    })
    expect(out?.view_count).toBe(1234567)
  })
})

describe('mapTranscript', () => {
  it('handles raw transcript string', () => {
    const out = mapTranscript({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      transcript: 'Hello   world   how  are  you',
    })
    expect(out).toEqual({
      video_id: 'dQw4w9WgXcQ',
      text: 'Hello world how are you',
      language: null,
    })
  })

  it('handles captions array of objects', () => {
    const out = mapTranscript({
      videoId: 'dQw4w9WgXcQ',
      captions: [{ text: 'one' }, { text: 'two' }, { text: 'three' }],
      language: 'en',
    })
    expect(out?.text).toBe('one two three')
    expect(out?.language).toBe('en')
  })

  it('handles array of strings', () => {
    const out = mapTranscript({
      videoId: 'dQw4w9WgXcQ',
      transcript: ['hello', 'world'],
    })
    expect(out?.text).toBe('hello world')
  })

  it('returns null when no id can be derived', () => {
    expect(mapTranscript({ transcript: 'hello' })).toBeNull()
  })

  it('returns null when text is empty', () => {
    expect(mapTranscript({ videoId: 'abcdefghijk', transcript: '   ' })).toBeNull()
  })
})

describe('startActorRun (and AppError mapping)', () => {
  it('throws AppError with code=apify_failed on non-200 from Apify', async () => {
    mockFetchOnce({ error: { type: 'record-not-found' } }, { status: 404 })
    await expect(
      startActorRun(fakeEnv(), 'apify/youtube-scraper', { startUrls: [] }, '/api/webhooks/apify', 'job1'),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('parses runId and datasetId on success', async () => {
    mockFetchOnce({ data: { id: 'run-123', defaultDatasetId: 'ds-456' } }, { status: 201 })
    const out = await startActorRun(
      fakeEnv(),
      'streamers/youtube-scraper',
      { startUrls: [] },
      '/api/webhooks/apify',
      'job1',
    )
    expect(out).toEqual({ runId: 'run-123', datasetId: 'ds-456' })
  })
})

describe('getRunStatus / getDatasetItems', () => {
  it('returns status string on success', async () => {
    mockFetchOnce({ data: { status: 'RUNNING' } })
    const s = await getRunStatus(fakeEnv(), 'run-1')
    expect(s).toBe('RUNNING')
  })

  it('throws AppError on Apify failure', async () => {
    mockFetchOnce('nope', { status: 500 })
    await expect(getRunStatus(fakeEnv(), 'run-1')).rejects.toBeInstanceOf(AppError)
  })

  it('returns dataset items array', async () => {
    mockFetchOnce([{ id: 'a' }, { id: 'b' }])
    const items = await getDatasetItems(fakeEnv(), 'ds-1')
    expect(items).toHaveLength(2)
  })
})
