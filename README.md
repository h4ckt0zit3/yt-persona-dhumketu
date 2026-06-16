# YouTube Personas & Knowledge Base

> Building Digital Duplicate AI personas from YouTube monologue creators across 100 niches.

## What This Project Does

Systematically extracts knowledge from YouTube creators who share expertise via monologue/talking-head format, then builds AI personas (digital duplicates) that can respond in their voice, style, and knowledge domain.

## Pipeline

```
Niche Discovery → Channel Discovery → Video Extraction → Transcription → Embedding → Persona Assembly
     (done)          (Apify)            (Apify)          (Apify+n8n)    (Supabase)    (LLM+RAG)
```

## Project Structure

```
├── 01-niches-database/          # 100 niches across 20 domains
│   └── niches-master.csv        # Master niche sheet
├── 02-channels-database/        # Top 100 channels per niche
│   ├── channels-master.csv      # Master channel sheet
│   └── channels-by-niche/       # Per-niche channel CSVs
├── 03-video-links/              # All video URLs from channels
│   └── video-links-master.csv   # Master video links sheet
├── 04-transcripts/              # Raw transcript files
├── 05-embeddings/               # Embedding configs and exports
├── 06-personas/                 # Generated persona profiles
├── pipeline/                    # Infrastructure-as-code
│   ├── apify/                   # Apify actor configs
│   ├── n8n/                     # n8n workflow specs
│   └── supabase/                # Database schema (SQL)
├── config/                      # Project configuration
├── scripts/                     # Utility scripts
└── docs/                        # Documentation
    ├── NICHES-ENCYCLOPEDIA.md   # Full niche documentation
    └── PIPELINE-REQUIREMENTS.md # End-to-end pipeline spec
```

## Scale

| Metric | Target |
|--------|--------|
| Domains | 20 |
| Niches | 100 |
| Channels per niche | 100 |
| Total channels | up to 10,000 |
| Videos per channel | ~200 avg |
| Total videos | ~2,000,000 |
| Personas | 10,000 |

## Tech Stack

- **Scraping:** Apify (YouTube scraper actors)
- **Orchestration:** n8n (workflow automation)
- **Database:** Supabase (PostgreSQL + pgvector)
- **Embeddings:** OpenAI text-embedding-3-small
- **Transcription:** YouTube captions + Whisper fallback
- **Persona LLM:** GPT-4o / Claude for style analysis

## Getting Started

1. Review niches: `01-niches-database/niches-master.csv`
2. Set up Supabase: Run `pipeline/supabase/schema.sql`
3. Configure Apify: Edit `pipeline/apify/actors-config.json`
4. Set up n8n workflows per `pipeline/n8n/workflows-spec.md`
5. Start with Wave 1 channels in priority niches

## Docs

- [Niches Encyclopedia](docs/NICHES-ENCYCLOPEDIA.md) - All 100 niches documented
- [Pipeline Requirements](docs/PIPELINE-REQUIREMENTS.md) - Full pipeline spec with costs
- [n8n Workflows](pipeline/n8n/workflows-spec.md) - Workflow specifications
