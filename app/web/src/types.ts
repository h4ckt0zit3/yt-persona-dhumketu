export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChannelRow {
  channel_id: string
  channel_name: string
  channel_url: string
  niche_id: string | null
  subscriber_count: number | null
  status: string
  video_count: number
  transcript_count: number
  chunk_count: number
  persona_status: string | null
}

export interface Persona {
  channel_id: string
  persona_name: string
  niche_id: string | null
  status: string
  style_profile: Record<string, unknown>
  knowledge_stats: Record<string, any>
  channel_url: string | null
  description: string | null
}

export interface Stats {
  niches: number
  channels: number
  active_channels: number
  videos: number
  transcripts: number
  personas: number
  chunks: number
}

export interface NicheRow {
  niche_id: string
  domain: string
  niche: string
  sub_niche: string | null
  persona_potential: string | null
  avg_cpm_usd: string | null
  description: string | null
  channel_count: number
}

export interface RunningJob {
  id: string
  job_type: string
  status: string
  channel_id: string | null
  started_at: string | null
  input_params: Record<string, any> | null
}

export interface CronTick {
  status: string
  completed_at: string | null
  output_stats: Record<string, any> | null
  error_message: string | null
}

export interface Activity {
  now: string
  running_jobs: RunningJob[]
  stages: {
    transcribing: { count: number; by_channel: Record<string, number> }
    embedding: { count: number; by_channel: Record<string, number> }
  }
  queues: {
    transcripts_pending: number
    transcripts_failed: number
    videos_pending: number
  }
  cron: {
    embed_drain: CronTick | null
    apify_poll: CronTick | null
  }
}
