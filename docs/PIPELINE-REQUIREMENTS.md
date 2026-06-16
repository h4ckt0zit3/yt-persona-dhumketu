# Digital Duplicate AI - Full Pipeline Requirements

> End-to-end system for creating AI personas from YouTube monologue creators.
> From niche discovery to embedded knowledge bases ready for persona deployment.

---

## Pipeline Overview

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  PHASE 1    │───>│  PHASE 2    │───>│  PHASE 3    │───>│  PHASE 4    │───>│  PHASE 5    │───>│  PHASE 6    │
│  Niche      │    │  Channel    │    │  Video Link │    │  Transcript │    │  Embedding  │    │  Persona    │
│  Discovery  │    │  Discovery  │    │  Extraction │    │  Extraction │    │  & Chunking │    │  Assembly   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
     CSV/MD            Apify              Apify              Apify            Supabase +         Supabase +
                    YouTube API        YouTube API         + n8n             OpenAI/Local        LLM Layer
```

---

## Phase 1: Niche Discovery & Mapping

**Status:** COMPLETE
**Output:** `01-niches-database/niches-master.csv`

### What was done:
- Identified 20 domains and 100 sub-niches
- Filtered for monologue/talking-head format creators only
- Rated each niche for CPM range, difficulty, and persona potential
- Created comprehensive encyclopedia documentation

### Deliverables:
| File | Description |
|------|-------------|
| `01-niches-database/niches-master.csv` | Master sheet with all 100 niches |
| `docs/NICHES-ENCYCLOPEDIA.md` | Full documentation with examples |

---

## Phase 2: Channel Discovery (Top 100 per Niche)

**Status:** TEMPLATE READY - AWAITING EXECUTION
**Output:** `02-channels-database/`

### Objective:
Find the top 100 channels in each of the 100 niches (up to 10,000 channels total).

### Method - Apify YouTube Search Scraper:

**Actor:** `apify/youtube-scraper` or `bernardo/youtube-channel-scraper`

**Search Strategy per Niche:**
1. Search YouTube with niche-specific keywords
2. Filter results by channel (not individual videos)
3. Sort by subscriber count and relevance
4. Verify channel format (must be monologue/talking-head)

**Data to Collect per Channel:**
```json
{
  "channel_id": "UC...",
  "channel_name": "Channel Name",
  "channel_url": "https://youtube.com/@handle",
  "subscriber_count": 500000,
  "total_videos": 350,
  "avg_views": 25000,
  "format_type": "monologue",
  "language": "en",
  "country": "US",
  "description": "Channel description...",
  "niche_id": "N001"
}
```

**n8n Workflow: `channel-discovery`**
```
Trigger (Manual/Cron)
  → Read niches-master.csv
  → For each niche:
    → Apify YouTube Search (keywords from niche)
    → Filter & rank results
    → Deduplicate against master
    → Insert to Supabase `channels` table
    → Export to CSV
```

### Deliverables:
| File | Description |
|------|-------------|
| `02-channels-database/channels-master.csv` | All channels across all niches |
| `02-channels-database/channels-by-niche/N001_*.csv` | Per-niche channel lists |

---

## Phase 3: Video Link Extraction

**Status:** TEMPLATE READY - AWAITING EXECUTION
**Output:** `03-video-links/`

### Objective:
Extract ALL video links from each discovered channel.

### Method - Apify YouTube Channel Scraper:

**Actor:** `apify/youtube-scraper` (mode: channel videos)

**Process:**
1. For each channel in `channels-master.csv`
2. Scrape the channel's video listing page
3. Extract all video URLs, titles, durations, view counts
4. Filter out Shorts (< 60 seconds) - we want long-form monologues
5. Store in `video-links-master.csv` and Supabase

**Data to Collect per Video:**
```json
{
  "video_id": "dQw4w9WgXcQ",
  "channel_id": "UC...",
  "niche_id": "N001",
  "video_title": "Video Title",
  "video_url": "https://youtube.com/watch?v=...",
  "published_date": "2024-01-15",
  "duration_seconds": 1200,
  "view_count": 150000,
  "like_count": 5000,
  "comment_count": 300
}
```

**n8n Workflow: `video-link-extraction`**
```
Trigger (Manual/Cron)
  → Read channels-master.csv (or query Supabase)
  → For each channel (batch of 10):
    → Apify YouTube Channel Scraper
    → Filter: duration > 60s (exclude Shorts)
    → Deduplicate against existing
    → Insert to Supabase `videos` table
    → Update channel record with video count
```

### Estimated Scale:
- ~10,000 channels x ~200 avg videos = ~2,000,000 video links
- Prioritize: Start with top 10 channels per niche (1,000 channels)

---

## Phase 4: Transcript Extraction

**Status:** ARCHITECTURE DEFINED
**Output:** `04-transcripts/` + Supabase `transcripts` table

### Objective:
Transcribe all extracted videos using Apify's YouTube transcript scraper.

### Method - Apify YouTube Transcript Scraper:

**Actor:** `bernardo/youtube-transcript-scraper` or `apify/youtube-transcript`

**Process:**
1. For each video in `video-links-master.csv`
2. Attempt to pull YouTube's auto-generated or uploaded captions
3. If no captions available, use Whisper API as fallback
4. Clean and normalize transcript text
5. Store raw transcript in Supabase

**Data Schema per Transcript:**
```json
{
  "transcript_id": "uuid",
  "video_id": "dQw4w9WgXcQ",
  "channel_id": "UC...",
  "niche_id": "N001",
  "language": "en",
  "raw_text": "Full transcript text...",
  "word_count": 5000,
  "extraction_method": "youtube_captions|whisper",
  "quality_score": 0.92,
  "created_at": "2026-04-16T00:00:00Z"
}
```

**n8n Workflow: `transcript-extraction`**
```
Trigger (Manual/Cron)
  → Query Supabase: videos WHERE transcript_status = 'pending'
  → Batch (50 videos at a time):
    → Apify YouTube Transcript Scraper
    → Clean text (remove timestamps, normalize spacing)
    → Calculate quality score
    → Insert to Supabase `transcripts` table
    → Update video record: transcript_status = 'completed'
  → On failure:
    → Mark transcript_status = 'failed'
    → Queue for Whisper fallback
```

### Whisper Fallback Workflow:
```
Trigger (Cron - daily)
  → Query Supabase: videos WHERE transcript_status = 'failed'
  → For each video:
    → Download audio via yt-dlp
    → Send to OpenAI Whisper API
    → Store transcript
    → Update status
```

---

## Phase 5: Embedding & Chunking

**Status:** ARCHITECTURE DEFINED
**Output:** Supabase `embeddings` table (pgvector)

### Objective:
Convert transcripts into searchable vector embeddings for persona knowledge retrieval.

### Chunking Strategy:

**Method:** Semantic chunking with overlap

```
Raw Transcript (5000 words)
  → Split into semantic chunks (~500-800 tokens each)
  → Overlap: 100 tokens between chunks
  → Metadata: channel_id, niche_id, video_id, chunk_index
  → Generate embedding vector for each chunk
```

**Chunking Rules:**
1. **Sentence boundary aware** - Never split mid-sentence
2. **Topic coherence** - Use NLP to detect topic shifts as chunk boundaries
3. **Size limits** - Min 200 tokens, Max 1000 tokens, Target 500 tokens
4. **Overlap** - 100 token overlap for context continuity
5. **Metadata enrichment** - Each chunk tagged with source video, timestamp range, topic

### Embedding Model Options:

| Model | Dimensions | Cost | Quality |
|-------|-----------|------|---------|
| OpenAI `text-embedding-3-large` | 3072 | $0.13/1M tokens | Best |
| OpenAI `text-embedding-3-small` | 1536 | $0.02/1M tokens | Good |
| Cohere `embed-english-v3.0` | 1024 | $0.10/1M tokens | Very Good |
| Local: `all-MiniLM-L6-v2` | 384 | Free | Decent |

**Recommended:** Start with `text-embedding-3-small` for cost efficiency, upgrade to `large` for production.

**Data Schema per Embedding:**
```json
{
  "embedding_id": "uuid",
  "transcript_id": "uuid",
  "video_id": "string",
  "channel_id": "string",
  "niche_id": "string",
  "chunk_index": 0,
  "chunk_text": "The actual text content...",
  "token_count": 500,
  "embedding_vector": [0.123, -0.456, ...],  // pgvector
  "topic_label": "investment_strategy",
  "created_at": "2026-04-16T00:00:00Z"
}
```

**n8n Workflow: `embedding-pipeline`**
```
Trigger (Cron/Webhook)
  → Query Supabase: transcripts WHERE embedding_status = 'pending'
  → For each transcript:
    → Chunk text (semantic splitter)
    → For each chunk:
      → Call OpenAI Embeddings API
      → Insert to Supabase `embeddings` table (pgvector)
    → Update transcript: embedding_status = 'completed'
```

### Supabase pgvector Setup:
```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings table with vector search
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID REFERENCES transcripts(id),
  video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  niche_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_count INTEGER,
  embedding vector(1536),  -- text-embedding-3-small
  topic_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector similarity search index
CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## Phase 6: Persona Assembly

**Status:** ARCHITECTURE DEFINED
**Output:** `06-personas/` + Supabase `personas` table

### Objective:
Assemble extracted knowledge into coherent AI personas that can respond as digital duplicates of the original creators.

### Persona Components:

```
┌─────────────────────────────────────┐
│           PERSONA PROFILE           │
├─────────────────────────────────────┤
│  Identity Layer                     │
│  ├─ Name, niche, expertise areas    │
│  ├─ Communication style analysis    │
│  ├─ Vocabulary fingerprint          │
│  └─ Personality traits              │
├─────────────────────────────────────┤
│  Knowledge Layer                    │
│  ├─ Vector embeddings (pgvector)    │
│  ├─ Topic taxonomy                  │
│  ├─ Key frameworks & mental models  │
│  └─ Frequently cited sources        │
├─────────────────────────────────────┤
│  Behavior Layer                     │
│  ├─ Response patterns               │
│  ├─ Teaching methodology            │
│  ├─ Argumentation style             │
│  └─ Common phrases & catchwords     │
└─────────────────────────────────────┘
```

### Persona Generation Pipeline:

1. **Style Analysis** - Analyze all transcripts for a channel to extract:
   - Speaking patterns, sentence structure, vocabulary
   - Common phrases, catchwords, transitions
   - Teaching methodology (stories, data, frameworks, analogies)

2. **Knowledge Extraction** - From embeddings:
   - Core topics and expertise areas
   - Key frameworks and mental models the creator uses
   - Opinions and stances on controversial topics

3. **System Prompt Generation** - Auto-generate system prompts:
   - Persona identity and background
   - Communication style instructions
   - Knowledge boundaries (what they know vs don't)
   - Response formatting preferences

4. **RAG Integration** - Connect to vector store:
   - Query embeddings for relevant context per user question
   - Inject retrieved chunks into LLM context
   - Respond in the creator's voice and style

### Persona Data Schema:
```json
{
  "persona_id": "uuid",
  "channel_id": "UC...",
  "persona_name": "Creator Name",
  "niche_id": "N001",
  "system_prompt": "You are [Creator]...",
  "style_profile": {
    "formality": 0.6,
    "humor": 0.3,
    "technical_depth": 0.8,
    "storytelling": 0.7,
    "vocabulary_level": "advanced",
    "common_phrases": ["here's the thing", "let me break this down"],
    "teaching_style": "framework-first"
  },
  "knowledge_stats": {
    "total_videos_processed": 350,
    "total_chunks": 15000,
    "total_tokens": 7500000,
    "top_topics": ["index_funds", "tax_optimization", "retirement"]
  },
  "status": "active",
  "created_at": "2026-04-16T00:00:00Z"
}
```

---

## Infrastructure Requirements

### Apify
- **Account tier:** Scale plan recommended for volume
- **Actors needed:**
  - `apify/youtube-scraper` - Channel and video discovery
  - YouTube transcript scraper - Transcript extraction
- **Estimated compute:** ~500 CU per 1000 videos scraped

### n8n
- **Instance:** Self-hosted or n8n Cloud
- **Workflows:**
  1. `channel-discovery` - Find top channels per niche
  2. `video-link-extraction` - Extract all video URLs from channels
  3. `transcript-extraction` - Pull transcripts via Apify
  4. `whisper-fallback` - Fallback transcription for failed videos
  5. `embedding-pipeline` - Chunk and embed transcripts
  6. `persona-builder` - Assemble persona profiles
- **Estimated workflows/month:** ~50,000 executions

### Supabase
- **Plan:** Pro plan minimum (for pgvector and storage)
- **Tables:** niches, channels, videos, transcripts, embeddings, personas
- **Storage:** Transcript text + embeddings
- **Estimated size:** ~50GB for 2M video transcripts with embeddings

### OpenAI API
- **Models:** `text-embedding-3-small` for embeddings
- **Estimated cost:** ~$200-500 for full embedding of 2M videos
- **Alternative:** Local sentence-transformers for cost savings

---

## Execution Priority Order

### Wave 1: Foundation (Week 1-2)
- [x] Complete niche mapping (100 niches across 20 domains)
- [ ] Set up Supabase project and tables
- [ ] Set up n8n instance
- [ ] Configure Apify account and actors

### Wave 2: Channel Discovery (Week 2-4)
- [ ] Run channel discovery for top 10 priority niches
- [ ] Manual QA review of discovered channels
- [ ] Expand to all 100 niches
- [ ] Populate channels-master.csv

### Wave 3: Video Extraction (Week 4-6)
- [ ] Extract video links from Wave 2 channels
- [ ] Filter for monologue format (>60s, talking head)
- [ ] Populate video-links-master.csv

### Wave 4: Transcription (Week 6-10)
- [ ] Run transcript extraction on all videos
- [ ] Run Whisper fallback on failures
- [ ] Quality check transcripts

### Wave 5: Embedding (Week 10-12)
- [ ] Implement chunking strategy
- [ ] Run embedding pipeline
- [ ] Build vector search indexes

### Wave 6: Persona Assembly (Week 12-14)
- [ ] Style analysis per channel
- [ ] Knowledge extraction per channel
- [ ] System prompt generation
- [ ] RAG integration testing

---

## Cost Estimates

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| Apify | $49-299 | Scale plan for volume |
| n8n | $0-50 | Self-hosted or cloud |
| Supabase | $25-75 | Pro plan with pgvector |
| OpenAI Embeddings | $50-200 | One-time for initial embedding |
| OpenAI Whisper | $100-300 | Fallback transcription only |
| **Total Setup** | **$225-925/mo** | During active pipeline execution |
| **Total Maintenance** | **$75-150/mo** | After initial processing |

---

*Last updated: 2026-04-16*
