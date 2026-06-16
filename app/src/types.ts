export interface Env {
  // Bindings
  AI: Ai
  ASSETS: Fetcher

  // Vars (wrangler.toml [vars])
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  ALLOWED_EMAILS: string
  LLM_PROVIDER: 'anthropic' | 'openai'
  CHAT_MODEL: string
  // "local" produces deterministic offline embeddings (no external call) so the
  // chunk -> embed -> persona path is fully runnable in dev. EMBED_DIM must match
  // the vector(N) width in schema.sql (default 1024).
  EMBED_PROVIDER: 'workers-ai' | 'openai' | 'local'
  EMBED_MODEL: string
  EMBED_DIM?: string
  MAX_VIDEOS_PER_CHANNEL: string
  // A running job older than this is considered stuck and force-failed by the
  // Cron poller (default 15). Guards against Apify runs whose webhook/status
  // never resolves leaving the job 'running' forever.
  MAX_JOB_AGE_MIN?: string
  APIFY_VIDEO_ACTOR: string
  APIFY_TRANSCRIPT_ACTOR: string
  PUBLIC_URL?: string
  OPENAI_BASE_URL?: string
  // Local-dev only: when "true" the auth gate is bypassed (no Supabase session
  // required) and the UI auto-signs-in. Set ONLY in .dev.vars, never as a
  // production secret. DEV_EMAIL is the identity used while bypassed.
  DEV_AUTH?: string
  DEV_EMAIL?: string

  // Secrets (wrangler secret put)
  SUPABASE_SERVICE_ROLE_KEY: string
  APIFY_TOKEN: string
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY?: string
  WEBHOOK_SECRET: string
}

export interface EmbedJob {
  transcript_id: string
  video_id: string
  channel_id: string
  niche_id: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
