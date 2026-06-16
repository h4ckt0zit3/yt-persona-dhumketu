-- ============================================================
-- Personas v2 — per-stage status migration (Phase P5)
-- ============================================================
-- ADDITIVE and IDEMPOTENT: safe to run on the existing database. It does NOT
-- drop or rewrite anything. It splits the overloaded `transcripts.embedding_
-- status` (which today covers clean + chunk + embed) into independent per-stage
-- states, and persists chunks so chunking is observable separately from
-- embedding. See docs/PERSONAS-V2-RESTRUCTURE.md §3.2 / §4.
--
-- Apply: paste into Supabase → SQL editor → Run. Code that READS these columns
-- ships in a later phase; until then they are harmless extra columns.
-- ============================================================

-- 1. Per-stage status on transcripts (Stage 3 clean, Stage 4 chunk).
--    `embedding_status` stays as the Stage 5 (embed) state.
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS clean_status TEXT DEFAULT 'pending';
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS chunk_status TEXT DEFAULT 'pending';
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS clean_metrics JSONB;        -- reduction %, lengths
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS cleaned_text TEXT;          -- output of Stage 3, input to Stage 4
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS stage_error TEXT;           -- last [stage]-tagged failure

CREATE INDEX IF NOT EXISTS idx_transcripts_clean_status ON transcripts(clean_status);
CREATE INDEX IF NOT EXISTS idx_transcripts_chunk_status ON transcripts(chunk_status);

-- 2. Persisted chunks (Stage 4 output, Stage 5 input). Makes chunk count and
--    embed count independently visible. Vectors still live in `embeddings`.
CREATE TABLE IF NOT EXISTS chunks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transcript_id UUID REFERENCES transcripts(id) ON DELETE CASCADE,
  video_id     TEXT,
  channel_id   TEXT,
  niche_id     TEXT,
  chunk_index  INTEGER NOT NULL,
  chunk_text   TEXT NOT NULL,
  token_count  INTEGER,
  embed_status TEXT DEFAULT 'pending',   -- pending → embedded | failed
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chunks_video        ON chunks(video_id);
CREATE INDEX IF NOT EXISTS idx_chunks_channel      ON chunks(channel_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embed_status ON chunks(embed_status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chunks_video_index ON chunks(video_id, chunk_index);

-- 3. Stage telemetry is already carried by pipeline_jobs.job_type = 'stage:<id>'
--    (written by app/src/stages/contract.ts → startStageRun). No schema change
--    needed for monitoring; GET /api/pipeline reads it.

-- ============================================================
-- Rollback (if ever needed):
--   DROP TABLE IF EXISTS chunks;
--   ALTER TABLE transcripts
--     DROP COLUMN IF EXISTS clean_status, DROP COLUMN IF EXISTS chunk_status,
--     DROP COLUMN IF EXISTS clean_metrics, DROP COLUMN IF EXISTS cleaned_text,
--     DROP COLUMN IF EXISTS stage_error;
-- ============================================================
