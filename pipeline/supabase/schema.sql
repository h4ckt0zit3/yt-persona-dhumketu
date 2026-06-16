-- ============================================================
-- YouTube Personas & Knowledge Base - Supabase Schema
-- Digital Duplicate AI Pipeline Database
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. NICHES TABLE
-- ============================================================
CREATE TABLE niches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche_id TEXT UNIQUE NOT NULL,           -- e.g., N001
  domain TEXT NOT NULL,                     -- e.g., "Finance & Investing"
  niche TEXT NOT NULL,                      -- e.g., "Personal Finance"
  sub_niche TEXT NOT NULL,                  -- e.g., "Budgeting & Saving"
  format_type TEXT DEFAULT 'Monologue',
  avg_cpm_usd TEXT,
  difficulty TEXT CHECK (difficulty IN ('Low', 'Medium', 'High')),
  persona_potential TEXT CHECK (persona_potential IN ('High', 'Very High')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_niches_domain ON niches(domain);
CREATE INDEX idx_niches_niche_id ON niches(niche_id);

-- ============================================================
-- 2. CHANNELS TABLE
-- ============================================================
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id TEXT UNIQUE NOT NULL,          -- YouTube channel ID (UC...)
  niche_id TEXT REFERENCES niches(niche_id),
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
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'blacklisted')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_channels_niche ON channels(niche_id);
CREATE INDEX idx_channels_status ON channels(status);
CREATE INDEX idx_channels_subs ON channels(subscriber_count DESC);

-- ============================================================
-- 3. VIDEOS TABLE
-- ============================================================
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT UNIQUE NOT NULL,            -- YouTube video ID
  channel_id TEXT REFERENCES channels(channel_id),
  niche_id TEXT REFERENCES niches(niche_id),
  video_title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  published_date DATE,
  duration_seconds INTEGER,
  view_count BIGINT,
  like_count BIGINT,
  comment_count BIGINT,
  has_transcript BOOLEAN DEFAULT FALSE,
  transcript_status TEXT DEFAULT 'pending' CHECK (transcript_status IN ('pending', 'processing', 'completed', 'failed', 'whisper_queued', 'whisper_completed')),
  last_scraped TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_videos_channel ON videos(channel_id);
CREATE INDEX idx_videos_niche ON videos(niche_id);
CREATE INDEX idx_videos_transcript_status ON videos(transcript_status);
CREATE INDEX idx_videos_published ON videos(published_date DESC);

-- ============================================================
-- 4. TRANSCRIPTS TABLE
-- ============================================================
CREATE TABLE transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT UNIQUE REFERENCES videos(video_id),
  channel_id TEXT REFERENCES channels(channel_id),
  niche_id TEXT REFERENCES niches(niche_id),
  language TEXT DEFAULT 'en',
  raw_text TEXT NOT NULL,
  word_count INTEGER,
  extraction_method TEXT CHECK (extraction_method IN ('youtube_captions', 'whisper', 'manual')),
  quality_score FLOAT,
  embedding_status TEXT DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transcripts_channel ON transcripts(channel_id);
CREATE INDEX idx_transcripts_embedding_status ON transcripts(embedding_status);

-- ============================================================
-- 5. EMBEDDINGS TABLE (pgvector)
-- ============================================================
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transcript_id UUID REFERENCES transcripts(id),
  video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  niche_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_count INTEGER,
  embedding vector(1536),                   -- text-embedding-3-small dimensions
  topic_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_embeddings_channel ON embeddings(channel_id);
CREATE INDEX idx_embeddings_niche ON embeddings(niche_id);
CREATE INDEX idx_embeddings_transcript ON embeddings(transcript_id);

-- Vector similarity search index (IVFFlat for speed)
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- 6. PERSONAS TABLE
-- ============================================================
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id TEXT UNIQUE REFERENCES channels(channel_id),
  persona_name TEXT NOT NULL,
  niche_id TEXT REFERENCES niches(niche_id),
  system_prompt TEXT,
  style_profile JSONB DEFAULT '{}',
  knowledge_stats JSONB DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'building', 'active', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_personas_niche ON personas(niche_id);
CREATE INDEX idx_personas_status ON personas(status);

-- ============================================================
-- 7. PIPELINE JOBS TABLE (tracking workflow runs)
-- ============================================================
CREATE TABLE pipeline_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type TEXT NOT NULL CHECK (job_type IN ('channel_discovery', 'video_extraction', 'transcript_extraction', 'whisper_fallback', 'embedding', 'persona_build')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input_params JSONB DEFAULT '{}',
  output_stats JSONB DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_jobs_type ON pipeline_jobs(job_type);
CREATE INDEX idx_pipeline_jobs_status ON pipeline_jobs(status);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function: Search embeddings by similarity for a specific channel (persona RAG)
CREATE OR REPLACE FUNCTION search_persona_knowledge(
  query_embedding vector(1536),
  target_channel_id TEXT,
  match_count INT DEFAULT 10,
  similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  chunk_text TEXT,
  video_id TEXT,
  topic_label TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.chunk_text,
    e.video_id,
    e.topic_label,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM embeddings e
  WHERE e.channel_id = target_channel_id
    AND 1 - (e.embedding <=> query_embedding) > similarity_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function: Search embeddings across a niche (cross-persona search)
CREATE OR REPLACE FUNCTION search_niche_knowledge(
  query_embedding vector(1536),
  target_niche_id TEXT,
  match_count INT DEFAULT 20,
  similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  chunk_text TEXT,
  channel_id TEXT,
  video_id TEXT,
  topic_label TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.chunk_text,
    e.channel_id,
    e.video_id,
    e.topic_label,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM embeddings e
  WHERE e.niche_id = target_niche_id
    AND 1 - (e.embedding <=> query_embedding) > similarity_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Trigger: Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_niches_updated_at BEFORE UPDATE ON niches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_channels_updated_at BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_videos_updated_at BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_transcripts_updated_at BEFORE UPDATE ON transcripts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_personas_updated_at BEFORE UPDATE ON personas FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (optional - enable per-project needs)
-- ============================================================
-- ALTER TABLE niches ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
