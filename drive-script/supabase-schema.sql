-- ============================================================
-- drive-script pipeline — Supabase schema (NEW ACCOUNT SETUP)
-- Paste into Supabase → SQL editor → Run.
--
-- Embedding model is all-MiniLM-L6-v2 (embedding.py) → vector(384).
--
-- Table names are PER-CHANNEL. This file uses "MarquesBrownlee" to match the
-- constants already in apify_to_supabase.py / chunking.py / embedding.py.
-- If you test a DIFFERENT channel, replace MarquesBrownlee everywhere below
-- AND update those same constants in the scripts (SUPABASE_TABLE / SOURCE_TABLE
-- / CHUNK_TABLE) and in the match_chunks function.
-- ============================================================

create extension if not exists vector;

-- 1) Raw + cleaned transcripts (one row per video).
--    apify_to_supabase.py inserts {file_name, content} (SERVICE_ROLE key).
--    clean_data fills clean_content.
create table if not exists "MarquesBrownlee" (
  id            bigint generated always as identity primary key,
  file_name     text,
  content       text,
  clean_content text,
  created_at    timestamptz default now()
);

-- 2) Chunks of clean_content. chunking.py inserts rows; embedding.py fills embedding.
create table if not exists "MarquesBrownlee_chunks" (
  id            bigint generated always as identity primary key,
  transcript_id bigint references "MarquesBrownlee"(id) on delete cascade,
  chunk_text    text not null,
  chunk_index   int  not null,
  embedding     vector(384),
  created_at    timestamptz default now()
);
create index if not exists idx_mb_chunks_transcript on "MarquesBrownlee_chunks"(transcript_id);

-- 3) Alternative ingestion target used ONLY by drive_to_supabase.py
--    (Google-Drive .txt files → Supabase). Skip if you only use apify_to_supabase.py.
create table if not exists transcriptions (
  id         bigint generated always as identity primary key,
  file_name  text,
  content    text,
  created_at timestamptz default now()
);

-- 4) Compatibility view: krs_engine.py's keyword fallback queries a table
--    literally named "chunks". This view points it at the real chunks table so
--    that path works WITHOUT editing the script.
create or replace view chunks as
  select id, transcript_id, chunk_text, chunk_index, embedding
  from "MarquesBrownlee_chunks";

-- 5) Vector-search RPC used by krs_engine.py (vector_search()).
create or replace function match_chunks(
  query_embedding vector(384),
  match_count     int   default 8,
  match_threshold float default 0.05
)
returns table (
  id            bigint,
  transcript_id bigint,
  chunk_text    text,
  chunk_index   int,
  similarity    float
)
language sql stable as $$
  select c.id, c.transcript_id, c.chunk_text, c.chunk_index,
         1 - (c.embedding <=> query_embedding) as similarity
  from "MarquesBrownlee_chunks" c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- 6) Grants. Writers (apify_to_supabase / clean_data / chunking / embedding) use the
--    SERVICE_ROLE key; readers (krs_engine, drive_to_supabase) use the ANON key.
--    RLS is left disabled for a private dev/test project.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete
  on "MarquesBrownlee", "MarquesBrownlee_chunks", transcriptions
  to anon, authenticated, service_role;
grant select on chunks to anon, authenticated, service_role;
grant execute on function match_chunks(vector, int, float) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================
-- RUN THIS *AFTER* embedding.py has populated the embeddings (speeds up search,
-- matches the hint embedding.py prints at the end):
--
--   create index on "MarquesBrownlee_chunks"
--     using ivfflat (embedding vector_cosine_ops) with (lists = 50);
--
-- NOTE on RLS: if anon reads come back empty, make sure Row Level Security is
-- DISABLED on these tables (default for SQL-editor-created tables) or add
-- policies — the grants above assume RLS is off.
-- ============================================================
