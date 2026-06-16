# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is primarily a **data + infrastructure-as-code repository** whose goal is to turn YouTube monologue/talking-head creators into AI "digital duplicate" personas via a 6-phase pipeline. The actual pipeline originally ran on external services (Apify, n8n, Supabase, OpenAI); this repo holds the specs, schemas, configs, and datasets that drive them.

The `app/` directory is the exception: it is a **real, runnable web app** that replaces n8n with a Cloudflare Worker + React/Vite dashboard. Almost all non-app work is editing CSVs, the SQL schema, or docs.

## app/ — Deployable Cloudflare app

A Cloudflare Workers (Hono API) + React/Vite dashboard that lets a user import channels, run ingestion, and chat with persona "digital duplicates." See `app/README.md` for setup/deploy.

**Stack:** Cloudflare Workers free plan + Supabase free tier (Postgres + pgvector). Deliberately no D1/Vectorize/R2/Queues.

### Commands (run from `app/`)

```bash
npm install

# Local dev (two terminals):
npm run dev          # React/Vite on :5173, proxies /api -> :8787
npm run dev:worker   # Worker on :8787

# Type check:
npm run typecheck

# Deploy:
npm run deploy       # vite build + wrangler deploy

# Seed existing CSV data:
node scripts/seed.mjs https://YOUR-APP.workers.dev niches   ../01-niches-database/niches-master.csv
node scripts/seed.mjs https://YOUR-APP.workers.dev channels ../02-channels-database/channels-master.csv
```

Local dev secrets go in `app/.dev.vars` (copy from `.dev.vars.example`). Production secrets use `wrangler secret put`.

### Versioning & deploy verification (IMPORTANT — keep this behavior)

The app shows its version in the sidebar footer. The **visible badge is the semver `x.x.x` from `app/package.json`** and nothing more (user preference — do NOT append build count or SHA to the visible text). The git short SHA + build time are still baked in (`vite.config.ts` Vite `define` → `__APP_VERSION__` = semver, `__APP_SHA__`, `__BUILD_TIME__`; declared in `web/src/globals.d.ts`, rendered by `VersionBadge` in `App.tsx`) but only appear in the badge's hover **tooltip**, never the visible text.

**Deploy-verification protocol (do this every time):** the verifiable marker is the `x.x.x` version. When a change should be checkable in production, **bump `app/package.json` version** (patch for fixes). At the END of every commit, print a clean block showing the committed `x.x.x`. The user reads the **version in the sidebar footer of the deployed app**: if it matches the latest committed `x.x.x`, the deploy reached production; if it's lower, the latest commits have NOT been deployed yet. Never remove the version badge, append more than `x.x.x` to the visible text, or drop this protocol.

This is also recorded in Claude memory (`project-versioning-deploy-verification`) so fresh/cleared sessions retain it.

### Architecture

| File | Role |
|---|---|
| `src/index.ts` | Worker entry: routes `/api` → Hono, serves SPA via `ASSETS` binding, runs 2-min Cron |
| `src/api.ts` | All Hono routes (`/api/stats`, `/api/channels`, `/api/chat`, `/api/webhooks/apify`, etc.) |
| `src/lib/pipeline.ts` | Ingest orchestration — replaces n8n; advances job state, calls Apify, chains video→transcript |
| `src/lib/embed.ts` | Chunks transcripts + embeds via Workers AI `bge-large` (1024-dim) or OpenAI; Cron drain |
| `src/lib/rag.ts` | Retrieval via `search_persona_knowledge()` (pgvector cosine) + prompt assembly |
| `src/lib/llm.ts` | Claude/OpenAI chat (streaming) |
| `src/lib/apify.ts` | Apify REST client + `mapVideo`/`mapTranscript` field mapping |
| `src/lib/supabase.ts` | Supabase client + `vecLiteral()` helper for pgvector inserts |
| `src/lib/chunk.ts` | Semantic chunker (500-token target, 100-token overlap) ported from n8n spec |
| `web/` | React + Vite + Tailwind SPA (Dashboard, Channels, Import, Chat pages) |

**Ingest flow:** "Ingest all" → `startVideoExtraction(chain=true)` → Apify webhook / Cron poll → `handleVideoDataset` → auto-chains into `startTranscriptExtraction` → Apify → `handleTranscriptDataset` (sets `embedding_status='pending'`) → Cron `drainPendingEmbeddings` → pgvector.

**Config knobs** (in `wrangler.toml [vars]`): `MAX_VIDEOS_PER_CHANNEL`, `LLM_PROVIDER`, `CHAT_MODEL`, `EMBED_PROVIDER`, `EMBED_MODEL`. Switch embedding providers by changing `EMBED_PROVIDER` and the `vector(N)` dimension in `app/schema.sql`.

**Schema note:** `app/schema.sql` is the authoritative schema the app uses — a superset of `pipeline/supabase/schema.sql`. It adds `pipeline_jobs.apify_run_id/dataset_id/channel_id` and a `channel_overview` view, and pins embedding dim to **1024** (Workers AI). Apply it by pasting into the Supabase SQL editor.

## The pipeline IS the directory structure

Data flows strictly `01 → 06`. Each phase's output is the next phase's input:

| Dir | Phase | Status | Produced by |
|-----|-------|--------|-------------|
| `01-niches-database/` | Niche discovery (100 niches / 20 domains) | **Complete** | Manual research |
| `02-channels-database/` | Channel discovery (top ~100/niche) | Partially populated | `generate_all.py` + Apify |
| `03-video-links/` | Video link extraction | Header-only (awaiting run) | Apify |
| `04-transcripts/` | Transcript extraction | Empty (gitignored, lives in Supabase) | Apify + Whisper fallback |
| `05-embeddings/` | Chunking + embedding | Empty (gitignored, lives in Supabase) | OpenAI + pgvector |
| `06-personas/` | Persona assembly | Template only | LLM (GPT-4o) + RAG |

Read `docs/PIPELINE-REQUIREMENTS.md` for the authoritative end-to-end spec.

## Two parallel data stores: CSV and Supabase

The same entities exist as both CSV files (source of truth in-repo) and Supabase tables (runtime store). They must stay schema-aligned — CSV column order/names mirror SQL table columns.

- CSV schemas: see headers in each `*-master.csv`.
- Table schemas: `pipeline/supabase/schema.sql` — 7 tables: `niches`, `channels`, `videos`, `transcripts`, `embeddings` (pgvector 1536-dim), `personas`, `pipeline_jobs`.
- If you add/rename a CSV column, update `schema.sql` to match, and vice versa.

### Status columns — the orchestration backbone

The app (and formerly n8n) polls Supabase for rows in a given state, processes them, and advances the state:

- `videos.transcript_status`: `pending → processing → completed | failed → whisper_queued → whisper_completed`
- `transcripts.embedding_status`: `pending → processing → completed | failed`
- `channels.status`: `pending → active | inactive | blacklisted`
- `personas.status`: `draft → building → active | archived`

Per-persona RAG retrieval: `search_persona_knowledge()` (cosine, scoped to one `channel_id`); cross-niche: `search_niche_knowledge()`.

## Key conventions

- **ID schemes:** niches use `N001`–`N100`; channels use `CHxxx`. **Gotcha:** `channels-master.csv` uses 3-digit IDs (`CH001`) while `channels-by-niche/` files use 4-digit IDs (`CH0001`). These do not join cleanly — reconcile before any cross-file join or DB import.
- **Format filter:** only monologue/talking-head creators. Exclude Shorts (`duration_seconds < 60`) and multi-host/interview formats. Applied at channel discovery (Phase 2) and video extraction (Phase 3).
- **Per-niche files:** `02-channels-database/channels-by-niche/N0xx_<slug>.csv`, one per niche (101 files), padded to 100 channels.
- **Secrets:** copy `config/env.example` → `config/env.local` (gitignored). For the app, use `app/.dev.vars` locally and `wrangler secret put` for production.
- **Niche reference:** `docs/NICHES-ENCYCLOPEDIA.md` — all 100 niches with CPM ranges and persona-potential ratings.

## Running the one non-app script

`02-channels-database/generate_all.py` writes the per-niche channel CSVs (covers N075–N100). Uses only Python stdlib.

```bash
python 02-channels-database/generate_all.py
```

Caveats: the output path `OUT` is hardcoded as an absolute Windows path — edit it if the repo lives elsewhere. Re-running overwrites existing files and discards manual edits for the niches it covers.

## Editing the deployable specs

These files are deployed to external services rather than executed locally:

- `pipeline/supabase/schema.sql` — run in Supabase SQL editor; requires `vector` and `uuid-ossp` extensions.
- `pipeline/apify/actors-config.json` — actor IDs and default inputs.
- `pipeline/n8n/workflows-spec.md` — prose+pseudocode spec for the original 6 n8n workflows (now replaced by the app's `pipeline.ts` for active use).

## Design System

Always read **`DESIGN.md`** before making any visual or UI decisions in `app/web/`. It is the project's design source of truth: aesthetic direction, color tokens, typography stack, spacing scale, component vocabulary, motion rules, accessibility requirements.

Do not introduce fonts, colors, spacing values, border-radii, or component patterns that conflict with DESIGN.md without explicit user approval. In QA mode, flag any code that doesn't match it. The Tailwind/CSS variables in `app/web/src/index.css` must mirror the tokens defined there.

Anti-patterns listed in DESIGN.md (purple gradients, AI sparkles, dark-mode-by-default, generic 3-column icon grids, etc.) are non-negotiable — do not introduce them even if asked indirectly.
