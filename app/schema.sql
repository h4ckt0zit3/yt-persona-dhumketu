-- ============================================================
-- YouTube Personas — Supabase (Postgres + pgvector) schema
-- Run this in the Supabase SQL editor. Safe to run on top of the
-- existing pipeline/supabase/schema.sql (uses IF NOT EXISTS).
--
-- ⚠️ EMBEDDING DIMENSION
-- This app defaults to Cloudflare Workers AI `bge-large-en-v1.5` = 1024 dims
-- (free). The `embeddings.embedding` column and the search function below are
-- therefore vector(1024).
--   • If you already created `embeddings` as vector(1536) (OpenAI) and have NO
--     rows yet: run the DROP in the marked section so it is recreated at 1024.
--   • If you want to keep OpenAI 1536: set EMBED_PROVIDER="openai" in
--     wrangler.toml and replace every `vector(1024)` here with `vector(1536)`.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. NICHES ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS niches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche_id TEXT UNIQUE NOT NULL,
  domain TEXT NOT NULL,
  niche TEXT NOT NULL,
  sub_niche TEXT,
  format_type TEXT DEFAULT 'Monologue',
  avg_cpm_usd TEXT,
  difficulty TEXT,
  persona_potential TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CHANNELS -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id TEXT UNIQUE NOT NULL,
  niche_id TEXT,
  channel_name TEXT NOT NULL,
  channel_url TEXT NOT NULL,
  subscriber_count BIGINT,
  total_videos INTEGER,
  avg_views BIGINT,
  format_type TEXT DEFAULT 'monologue',
  language TEXT DEFAULT 'en',
  country TEXT,
  description TEXT,
  last_scraped TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_channels_niche ON channels(niche_id);
CREATE INDEX IF NOT EXISTS idx_channels_status ON channels(status);

-- 3. VIDEOS ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT UNIQUE NOT NULL,
  channel_id TEXT,
  niche_id TEXT,
  video_title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  published_date DATE,
  duration_seconds INTEGER,
  view_count BIGINT,
  like_count BIGINT,
  comment_count BIGINT,
  has_transcript BOOLEAN DEFAULT FALSE,
  transcript_status TEXT DEFAULT 'pending',
  last_scraped TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_transcript_status ON videos(transcript_status);

-- 4. TRANSCRIPTS (raw_text stored here — no R2) ---------------------------
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT UNIQUE,
  channel_id TEXT,
  niche_id TEXT,
  language TEXT DEFAULT 'en',
  raw_text TEXT NOT NULL,
  word_count INTEGER,
  extraction_method TEXT,
  quality_score FLOAT,
  embedding_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transcripts_channel ON transcripts(channel_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_embedding_status ON transcripts(embedding_status);

-- 5. EMBEDDINGS (pgvector) ------------------------------------------------
-- >>> If migrating an empty 1536 table to 1024, uncomment the next line:
-- DROP TABLE IF EXISTS embeddings CASCADE;
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transcript_id UUID,
  video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  niche_id TEXT,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_count INTEGER,
  embedding vector(1024),          -- bge-large-en-v1.5 (Workers AI). 1536 for OpenAI.
  topic_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_embeddings_channel ON embeddings(channel_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_niche ON embeddings(niche_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector
  ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 6. PERSONAS -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id TEXT UNIQUE,
  persona_name TEXT NOT NULL,
  niche_id TEXT,
  system_prompt TEXT,
  style_profile JSONB DEFAULT '{}',
  knowledge_stats JSONB DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personas_status ON personas(status);
-- FK lets PostgREST auto-resolve the personas → channels join used by /api/personas.
ALTER TABLE personas DROP CONSTRAINT IF EXISTS personas_channel_id_fkey;
ALTER TABLE personas
  ADD CONSTRAINT personas_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE;

-- 7. PIPELINE JOBS --------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  input_params JSONB DEFAULT '{}',
  output_stats JSONB DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- columns this app adds on top of the original pipeline_jobs:
ALTER TABLE pipeline_jobs ADD COLUMN IF NOT EXISTS channel_id TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN IF NOT EXISTS apify_run_id TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN IF NOT EXISTS apify_dataset_id TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_status ON pipeline_jobs(status);

-- ---- RAG search function (cosine, scoped to one channel) ----------------
CREATE OR REPLACE FUNCTION search_persona_knowledge(
  query_embedding vector(1024),
  target_channel_id TEXT,
  match_count INT DEFAULT 10,
  similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (chunk_text TEXT, video_id TEXT, topic_label TEXT, similarity FLOAT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT e.chunk_text, e.video_id, e.topic_label, 1 - (e.embedding <=> query_embedding) AS similarity
  FROM embeddings e
  WHERE e.channel_id = target_channel_id
    AND 1 - (e.embedding <=> query_embedding) > similarity_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ---- Dashboard/list view: channels + derived counts --------------------
CREATE OR REPLACE VIEW channel_overview AS
SELECT
  c.channel_id, c.channel_name, c.channel_url, c.niche_id, c.subscriber_count, c.status,
  (SELECT COUNT(*) FROM videos v WHERE v.channel_id = c.channel_id) AS video_count,
  (SELECT COUNT(*) FROM transcripts t WHERE t.channel_id = c.channel_id) AS transcript_count,
  (SELECT COUNT(*) FROM embeddings e WHERE e.channel_id = c.channel_id) AS chunk_count,
  (SELECT p.status FROM personas p WHERE p.channel_id = c.channel_id) AS persona_status
FROM channels c;

-- ---- Grants ------------------------------------------------------------
-- Supabase normally grants public-schema privileges to service_role automatically,
-- but some projects (older ones, or schemas applied a certain way) miss this.
-- Apply explicitly so the worker (which uses service_role) can always read/write.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;
-- Views don't inherit table grants in Supabase; grant explicitly.
GRANT SELECT ON channel_overview TO service_role, authenticated, anon;

-- Refresh PostgREST's schema cache so new FKs / views / grants are visible.
NOTIFY pgrst, 'reload schema';
