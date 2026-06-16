import type { Env } from '../types'
import { AppError, fromHttpError } from './errors'

// Apify REST helpers. Actor IDs in the API use `~` instead of `/`
// (e.g. "apify/youtube-scraper" -> "apify~youtube-scraper").
function actorPath(slug: string): string {
  return slug.replace('/', '~')
}

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}

export interface StartedRun {
  runId: string
  datasetId: string
}

/**
 * Start an actor run asynchronously. If PUBLIC_URL is set, registers an
 * ad-hoc webhook so Apify calls us back on success/failure. The Cron
 * fallback in index.ts also polls, so webhooks are optional.
 */
export async function startActorRun(
  env: Env,
  actorSlug: string,
  input: unknown,
  webhookPath: string,
  jobId: string,
): Promise<StartedRun> {
  let url = `https://api.apify.com/v2/acts/${actorPath(actorSlug)}/runs?token=${env.APIFY_TOKEN}`

  if (env.PUBLIC_URL) {
    const webhooks = [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT'],
        requestUrl: `${env.PUBLIC_URL}${webhookPath}?secret=${encodeURIComponent(env.WEBHOOK_SECRET)}&jobId=${jobId}`,
      },
    ]
    url += `&webhooks=${encodeURIComponent(b64(JSON.stringify(webhooks)))}`
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw fromHttpError('apify_failed', 'Apify start', res.status, await res.text())
  }
  const json = (await res.json()) as { data: { id: string; defaultDatasetId: string } }
  return { runId: json.data.id, datasetId: json.data.defaultDatasetId }
}

export async function getRunStatus(env: Env, runId: string): Promise<string> {
  const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${env.APIFY_TOKEN}`)
  if (!res.ok) throw new AppError('apify_failed', `Apify run status failed (${res.status})`, { retryable: true })
  const json = (await res.json()) as { data: { status: string } }
  return json.data.status // READY|RUNNING|SUCCEEDED|FAILED|ABORTED|TIMED-OUT
}

export async function getDatasetItems(env: Env, datasetId: string): Promise<any[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}&clean=true&format=json`,
  )
  if (!res.ok) throw new AppError('apify_failed', `Apify dataset fetch failed (${res.status})`, { retryable: true })
  return (await res.json()) as any[]
}

// ---- Defensive field mapping (actor output schemas vary) ----------------

export interface MappedVideo {
  video_id: string
  video_title: string
  video_url: string
  published_date: string | null
  duration_seconds: number | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
}

export function mapVideo(item: any): MappedVideo | null {
  const url: string | undefined = item.url || item.videoUrl || item.link
  const id: string | undefined =
    item.id || item.videoId || item.video_id || (url ? extractVideoId(url) : undefined)
  const title: string | undefined = item.title || item.videoTitle || item.name
  if (!id || !url || !title) return null
  return {
    video_id: id,
    video_title: title,
    video_url: url,
    published_date: normalizeDate(item.date ?? item.publishedAt ?? item.uploadDate),
    duration_seconds: parseDuration(item.duration ?? item.durationSeconds ?? item.lengthSeconds),
    view_count: numOrNull(item.viewCount ?? item.views),
    like_count: numOrNull(item.likes ?? item.likeCount),
    comment_count: numOrNull(item.commentsCount ?? item.commentCount),
  }
}

export interface MappedTranscript {
  video_id: string
  text: string
  language: string | null
}

export function mapTranscript(item: any): MappedTranscript | null {
  const url: string | undefined = item.videoUrl || item.url
  const id: string | undefined =
    item.videoId || item.video_id || item.id || (url ? extractVideoId(url) : undefined)
  if (!id) return null

  let text = ''
  if (typeof item.transcript === 'string') text = item.transcript
  else if (typeof item.text === 'string') text = item.text
  else if (Array.isArray(item.captions)) text = item.captions.map((c: any) => c.text ?? c).join(' ')
  else if (Array.isArray(item.transcript)) text = item.transcript.map((c: any) => c.text ?? c).join(' ')
  else if (Array.isArray(item.data)) text = item.data.map((c: any) => c.text ?? c).join(' ')

  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return { video_id: id, text, language: item.language || item.lang || null }
}

function extractVideoId(url: string): string | undefined {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/)
  return m?.[1]
}

// YouTube scrapers return dates in many shapes: ISO ("2024-01-15T…"), plain
// "2024-01-15", or relative ("2 years ago", "Streamed live …"). The DB column
// is DATE, so a relative string would make the whole videos upsert fail. Return
// a YYYY-MM-DD string when we can parse one, else null (never a junk string).
function normalizeDate(v: any): string | null {
  if (v === undefined || v === null || v === '') return null
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

function numOrNull(v: any): number | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return Math.round(v)
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

// Accepts seconds (number) or "MM:SS" / "HH:MM:SS" / ISO8601 "PT12M3S".
function parseDuration(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'number') return Math.round(v)
  const s = String(v)
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => parseInt(p, 10))
    return parts.reduce((acc, p) => acc * 60 + (Number.isNaN(p) ? 0 : p), 0)
  }
  const iso = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (iso) {
    const [, h, m, sec] = iso
    return (parseInt(h || '0') * 3600) + (parseInt(m || '0') * 60) + parseInt(sec || '0')
  }
  return null
}
