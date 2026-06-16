# Personas v2 — Restructure into a Monitorable Stage System

**Branch:** `Personas-v2`
**Goal:** turn the tangled pipeline into 5 clearly-separated, individually
observable stages (+ RAG chat) so that when something breaks, you can see *which
stage* failed and *which row* is stuck — in seconds, not by reading code.

---

## Part 1 — Elaboration: how the codebase works today

Your five processes, mapped to the real code:

| # | Your stage | Where it lives now | Advances | Job telemetry |
|---|---|---|---|---|
| 1 | **Fetch videos** | `pipeline.ts:59 startVideoExtraction`, `:83 handleVideoDataset`, `apify.ts mapVideo` | inserts `videos`, sets `transcript_status='pending'` | `pipeline_jobs.job_type='video_extraction'` |
| 2 | **Transcribe & save** | `pipeline.ts:140 startTranscriptExtraction`, `:183 handleTranscriptDataset` + `clean.ts:6 minimalClean` | inserts `transcripts` (`embedding_status='pending'`), sets `videos.transcript_status='completed'` | `job_type='transcript_extraction'` |
| 3 | **Clean (deep)** | `clean.ts:37 deepClean` — **called inside** `embed.ts:88` | *(no own state)* | *(none — hidden inside embed)* |
| 5 | **Chunk** | `chunk.ts:4 semanticChunk` — **called inside** `embed.ts:93` | *(no own state)* | *(none — hidden inside embed)* |
| 4 | **Embed** | `embed.ts:33 embedTexts` — **called inside** `embed.ts:109` | inserts `embeddings`, sets `embedding_status='completed'` | `job_type='cron_embed_drain'` (shared) |
| — | **RAG Chat** | `rag.ts retrieve/buildPersonaSystem/buildUserTurn`, `llm.ts streamChat`, `api.ts:478 /chat` | reads `embeddings` via `search_persona_knowledge()` | *(none)* |
| — | *Persona build* | `pipeline.ts:350 buildPersona` (Phase 6) | sets `personas.status='active'` | per-call |

Orchestration today: `index.ts scheduled()` runs `pollRunningJobs` + `drainPendingEmbeddings(3)` every 2 min; `api.ts` routes trigger stages on demand; the Apify webhook advances fetch/transcribe.

> Note on ordering: you listed embed (4) before chunk (5), but the real data flow
> is **clean → chunk → embed**. v2 keeps that true order while making each step its
> own visible stage.

---

## Part 2 — Why debugging is hard right now (the diagnosis)

Three concrete structural problems:

1. **Three stages are fused into one function.** `embedTranscript()`
   (`embed.ts:75`) does **clean → chunk → embed** in one body, under **one status
   column** (`transcripts.embedding_status`) and **one job row**
   (`cron_embed_drain`). So when a persona sounds wrong or a row is stuck, you
   cannot tell whether:
   - `deepClean` over-stripped the text (e.g. niche filler rules nuked real words),
   - `semanticChunk` split badly (empty/oversized chunks), or
   - `embedTexts` failed (Workers-AI quota).
   They all look the same from the outside: `embedding_status` and one error string.

2. **Two different "cleans" with no shared identity.** `minimalClean`
   (`clean.ts:6`, at save) and `deepClean` (`clean.ts:37`, at embed) are separate
   passes at separate times, neither independently inspectable. You can't see the
   before/after of cleaning for a given video.

3. **`pipeline.ts` is a god-file (433 lines).** It mixes fetch, transcribe, job
   bookkeeping, cron polling, *and* persona build. Changing one stage means reading
   all of them; a failure in one is reported through shared plumbing.

Net effect: the system has **6 logical stages but only ~3 observable states**, so
failures collapse into ambiguous buckets.

---

## Part 3 — Target v2 architecture

### 3.1 One uniform Stage contract

Every stage becomes a self-contained module under `app/src/stages/` implementing
the **same** interface, so the orchestrator and the monitor treat them identically:

```ts
type StageId = 'fetch' | 'transcribe' | 'clean' | 'chunk' | 'embed' | 'chat'

interface StageRunResult {
  stage: StageId
  startedAt: string
  finishedAt: string
  seen: number          // candidate rows in input state
  advanced: number      // rows successfully moved to next state
  failed: number
  errors: { ref: string; message: string }[]
}

interface Stage {
  id: StageId
  title: string
  // Process a BOUNDED batch: read rows in this stage's input state, do the work,
  // advance state, and ALWAYS write a stage-tagged pipeline_jobs row.
  run(env: Env, opts?: { limit?: number; channelId?: string }): Promise<StageRunResult>
  // Cheap read for the monitor: queue depth, inflight, failed, last run/error.
  health(env: Env): Promise<StageHealth>
}
```

Each `run()` writes `pipeline_jobs.job_type = 'stage:<id>'` with per-row outcomes —
so the heartbeat, throughput, and last error of **every** stage are first-class.

### 3.2 Per-stage state (the key fix)

Split the overloaded `embedding_status` so a transcript flows through *visible*
states instead of one opaque one:

```
transcripts.clean_status:  pending → cleaned | failed     (Stage 3)
transcripts.chunk_status:  pending → chunked | failed     (Stage 4=chunk)
transcripts.embed_status:  pending → embedded | failed    (Stage 5=embed)
```

(Plus the existing `videos.transcript_status` for stages 1–2.) Now a stuck row
tells you *exactly* where it stopped. Chunks are persisted before embedding so
chunking is inspectable on its own (see schema note §3.4).

### 3.3 Stage registry + thin orchestrator

`app/src/stages/index.ts` exports an ordered registry `[fetch, transcribe, clean,
chunk, embed]`. The Cron and the orchestrator just iterate the registry calling
`run()` — no stage-specific branching. `pipeline.ts` shrinks to pure
orchestration (advance jobs, poll Apify); each stage's *logic* lives in its module.

### 3.4 Monitoring as a first-class surface

- New `GET /api/pipeline` returns one row per stage: `{ id, title, queue, inflight,
  done, failed, lastRunAt, lastError }` — built from the `stage:*` job rows + the
  per-stage status columns.
- Dashboard gets a **5-stage board** (Fetch → Transcribe → Clean → Chunk → Embed →
  Chat): each tile green/amber/red with its queue depth and last error. This is the
  "works as a system, debug in seconds" payoff.

### 3.5 Proposed layout

```
app/src/stages/
  contract.ts        # StageId, StageRunResult, StageHealth, Stage, helpers (writeStageJob)
  fetch.ts           # Stage 1  (from pipeline.ts video extraction)
  transcribe.ts      # Stage 2  (from pipeline.ts transcript extraction + minimalClean)
  clean.ts           # Stage 3  (deepClean as its own DB pass)
  chunk.ts           # Stage 4  (semanticChunk → persisted chunks)
  embed.ts           # Stage 5  (vectorize chunks → pgvector)
  chat.ts            # RAG chat (retrieve + assemble + stream)
  index.ts           # ordered registry + runStage dispatch
app/src/lib/         # unchanged primitives: apify, supabase, llm, errors, csv
  clean-rules.ts     # pure deepClean/minimalClean text fns (moved out of clean.ts)
  chunk-algo.ts      # pure semanticChunk (moved out of chunk.ts)
```

Pure text/vector algorithms stay as **pure, unit-testable functions** in `lib/`;
the `stages/*` modules own DB state + telemetry. Clean separation = quick debugging.

---

## Part 4 — Schema changes (phased, additive)

Phase B introduces (all additive, no destructive migration):

```sql
alter table transcripts add column if not exists clean_status text default 'pending';
alter table transcripts add column if not exists chunk_status text default 'pending';
-- rename embedding_status semantics to embed-only; keep column, add chunks table:
create table if not exists chunks (
  id uuid primary key default uuid_generate_v4(),
  transcript_id uuid references transcripts(id),
  video_id text, channel_id text, niche_id text,
  chunk_index int, chunk_text text, token_count int,
  embed_status text default 'pending',
  created_at timestamptz default now()
);
```

Embedding then reads `chunks where embed_status='pending'` and writes the vector
into `embeddings` — so chunk count and embed count are independently visible.

---

## Part 5 — Migration plan (safe & incremental, typecheck after each)

- [x] **P0** Branch `Personas-v2`.
- [x] **P1** This elaboration + target architecture doc.
- [x] **P2** `stages/contract.ts` — uniform `Stage` interface, `StageRunResult`/`StageHealth`, `startStageRun` telemetry helper.
- [x] **P3** Split the fused `embedTranscript` into stage-attributed steps (`cleanStep`/`chunkStep` + tagged embed) so every throw is labelled `[clean]`/`[chunk]`/`[embed]`.
- [x] **P4** Extracted `stages/fetch.ts`, `stages/transcribe.ts`, `stages/persona.ts`, `stages/jobs.ts`; `pipeline.ts` is now orchestration-only (dispatch + Cron poll + cancel + guards). *(typecheck + 112 tests green)*
- [x] **P6a** `GET /api/pipeline` (`stages/monitor.ts`) — per-stage queue/inflight/failed + tagged-failure split, mapped onto the 5-stage model.
- [x] **P6b** Dashboard 5-stage board (`web/src/components/PipelineBoard.tsx`) wired into `Dashboard.tsx`. *(vite build green, DESIGN.md tokens only)*
- [x] **P7** `stages/chat.ts` (consolidated rag + llm + persona-chat; `/api/chat` is now a thin adapter).
- [ ] **P5 (apply)** Run `app/schema-v2-stages.sql` in Supabase, then wire `stages/embed.ts` to read the persisted `chunks` table so chunk vs embed get independent DB state. *(file ready; blocked on Supabase access from this machine — ISP DNS block; apply from the Supabase dashboard)*

### Verification at this milestone
- `npm run typecheck` → clean
- `npm test` → **112 passed (11 files)**
- `npm run build` → clean (87 modules)

### New module map (v2)
```
src/stages/
  contract.ts    Stage interface + telemetry helper
  jobs.ts        shared pipeline_jobs bookkeeping (cycle-free)
  fetch.ts       Stage 1 — video extraction
  transcribe.ts  Stage 2 — transcripts + minimalClean
  embed.ts*      Stages 3–5 — cleanStep/chunkStep + embed (*still in lib/embed.ts; logic decomposed)
  persona.ts     Phase 6 — persona assembly
  chat.ts        RAG chat runtime
  monitor.ts     GET /api/pipeline aggregation
src/lib/pipeline.ts  orchestration only (dispatch, Cron poll, cancel, guards)
```

> **Blocker for P5:** this machine cannot reach `supabase.co` (ISP DNS block →
> `49.44.79.236`), so the migration must be applied from the Supabase dashboard or
> a network that can reach it. The migration is additive/idempotent and safe to
> run any time.

Each phase keeps the app building and deployable; no step requires a big-bang
rewrite. Version bump + deploy-verification per `CLAUDE.md` applies at P5/P6 (the
first phases that change deployed behavior).
