# YouTube Personas — Cloudflare + Supabase app

A deployable web app that turns YouTube monologue creators into chattable AI
"digital duplicates." You and your intern manage everything from a dashboard:
import channels, click **Ingest all** (Apify pulls videos + transcripts, which
then auto-embed), click **Build persona**, then **Chat**.

Runs on the **Cloudflare Workers free plan** + **Supabase free tier**. No n8n,
no servers, and no paid Cloudflare features (no D1/Vectorize/R2/Queues).

## Architecture

| Concern | Service | Where |
|---|---|---|
| API + pages | Cloudflare Workers (free) — Hono + React | `src/`, `web/` |
| Relational data | **Supabase Postgres** | `schema.sql` |
| Embeddings + search | **Supabase pgvector** (`search_persona_knowledge()`) | `src/lib/rag.ts` |
| Transcript text | **Supabase** `transcripts.raw_text` | `src/lib/pipeline.ts` |
| Embedding model | **Workers AI** `bge-large` (1024-dim, free tier) | `src/lib/embed.ts` |
| Chat model | Anthropic Claude (or OpenAI) | `src/lib/llm.ts` |
| Orchestration | Worker routes + **Cron** (free) | `src/api.ts`, `src/index.ts` |
| Scraping | **Apify** REST + webhooks | `src/lib/apify.ts` |
| Login | **Cloudflare Access** (dashboard) | — |

Flow: `CSV → Supabase → Apify videos → Apify transcripts → chunk+embed → pgvector → Build persona → RAG chat`.
Background work (checking Apify runs, embedding new transcripts) is driven by a
Cron trigger every 2 minutes — no Queues needed.

## Prerequisites

- A **Supabase** project (free tier is fine to start) — you already have one.
- A **Cloudflare** account (free plan — Workers AI's free allocation covers embeddings).
- An **Apify** account + API token.
- An **Anthropic** (or OpenAI) API key for chat.
- Node 18+ and `npm`.

## One-time setup

```bash
cd app
npm install
npx wrangler login
```

1. **Database** — open Supabase → SQL editor → paste & run `schema.sql`.
   - Read the ⚠️ dimension note at the top: the app defaults to **1024-dim**
     (Workers AI). If your existing `embeddings` table is 1536 and empty,
     uncomment the `DROP TABLE` line so it recreates at 1024. To keep OpenAI
     1536 instead, set `EMBED_PROVIDER="openai"` and change every `vector(1024)`
     to `vector(1536)`.

2. **Config** — in `wrangler.toml` set `SUPABASE_URL` (Supabase → Project
   Settings → API → Project URL).

3. **Secrets** (Supabase service-role key from the same API settings page):
   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put APIFY_TOKEN
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put WEBHOOK_SECRET     # any long random string
   # npx wrangler secret put OPENAI_API_KEY   # only if using OpenAI
   ```

## Deploy

```bash
npm run deploy        # builds the React app + deploys the Worker
```

After the first deploy, copy your `*.workers.dev` URL into `wrangler.toml` as
`PUBLIC_URL` (under `[vars]`) and `npm run deploy` again — this lets Apify call
the webhook back. Without it the 2-minute Cron still advances everything, just a
little slower.

## Lock it down (Cloudflare Access)

Cloudflare dashboard → **Zero Trust → Access → Applications** → add a
self-hosted app for your Worker URL, policy = allow only your + your intern's
emails. No code; this gates the whole site.

## Seed your existing data

From the **Import** tab (paste/upload CSV), or from the CLI:

```bash
node scripts/seed.mjs https://YOUR-APP.workers.dev niches   ../01-niches-database/niches-master.csv
node scripts/seed.mjs https://YOUR-APP.workers.dev channels ../02-channels-database/channels-master.csv
# or one niche file:
node scripts/seed.mjs https://YOUR-APP.workers.dev channels ../02-channels-database/channels-by-niche/N001_budgeting_saving.csv
```

(If your Supabase already has channel/niche rows, you can skip this — the app
reads them directly.)

## Daily use

1. **Channels** tab → pick a creator → **Ingest all**. Counts (vids/trans/chunks) update as work lands (Cron embeds new transcripts every ~2 min).
2. When chunks > 0 → **Build persona**.
3. **Chat** (or the **Personas** tab) → talk to the digital duplicate.

## Staying inside the free tiers

- **Supabase free** = 500 MB DB. Transcripts + embeddings add up: roughly
  ~6 KB per chunk. A few creators is comfortable; a full 100-channel niche may
  approach the limit — keep `MAX_VIDEOS_PER_CHANNEL` modest (default 50) or move
  to Supabase Pro when you scale.
- **Workers AI free** = a daily Neuron allowance. The Cron embeds 3 transcripts
  per tick to spread usage; heavy backfills may pause until the next day.
- **Apify** is the one usage-based cost (its own plan), unchanged.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in keys (incl. SUPABASE_SERVICE_ROLE_KEY)
npm run dev:worker               # Worker on :8787 (terminal 1)
npm run dev                      # React/Vite on :5173, proxies /api -> :8787 (terminal 2)
```

Supabase is hit over HTTPS, so local dev talks to your real Supabase project.
Apify webhooks need a public URL, so locally rely on the Cron poller (or deploy
a preview).

## Tuning

- `MAX_VIDEOS_PER_CHANNEL`, `CHAT_MODEL`, `LLM_PROVIDER`, `EMBED_PROVIDER`,
  `EMBED_MODEL` — all in `wrangler.toml` `[vars]`.
- Apify output field names vary by actor — `mapVideo`/`mapTranscript` in
  `src/lib/apify.ts` is where to adjust mapping if you change actors.

## Files

```
app/
  schema.sql            Supabase Postgres + pgvector schema (run in SQL editor)
  wrangler.toml         Worker config (only AI binding + Cron — no paid features)
  src/
    index.ts            Worker entry: fetch + cron (poll Apify + drain embeddings)
    api.ts              all /api routes (Hono)
    lib/
      supabase.ts       Supabase client + pgvector literal helper
      apify.ts          Apify REST client + output mapping
      pipeline.ts       ingest orchestration + persona build (replaces n8n)
      embed.ts          chunk + embed -> Supabase pgvector (Workers AI / OpenAI)
      chunk.ts          semantic chunker (ported from n8n spec)
      rag.ts            retrieval via search_persona_knowledge() + prompt assembly
      llm.ts            Claude/OpenAI chat (streaming, prompt-cached)
      csv.ts            CSV parser
  web/                  React + Vite + Tailwind dashboard
  scripts/seed.mjs      CLI CSV importer
```
