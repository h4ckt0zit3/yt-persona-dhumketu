"""
STEP 4 — EMBEDDINGS
====================
Converts chunk_text → vector using the free local model all-MiniLM-L6-v2
(384 dims). Designed to run on the cloud runner (GitHub Actions): the model
weights (~90MB) are pulled from the HuggingFace cache once (cached across runs
by the workflow's actions/cache step, authenticated via the HF_TOKEN env var)
and reused — nothing is re-installed each run.

pip install sentence-transformers
"""
from sentence_transformers import SentenceTransformer
from supabase import create_client
import time

# ─────── CONFIG ───────────────────────────────────────────────────────────────────
import os
from dotenv import load_dotenv
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

CHUNK_TABLE = "MarquesBrownlee_chunks"
BATCH_SIZE  = 100   # process 100 chunks at a time (faster than one by one)
# ──────────────────────────────────────────────────────────────────────────────

# Model is loaded lazily inside main() — only when there are chunks to embed —
# so a no-op run (everything already embedded) never downloads the weights.
MODEL_NAME = "all-MiniLM-L6-v2"
supabase   = create_client(SUPABASE_URL, SUPABASE_KEY)


def main():
    # Count stats
    total = supabase.table(CHUNK_TABLE).select("id", count="exact").execute().count
    done  = (
        supabase.table(CHUNK_TABLE)
        .select("id", count="exact")
        .not_.is_("embedding", "null")
        .execute()
        .count
    )
    remaining = total - done

    print("=" * 55)
    print("   🔢 EMBEDDING STEP")
    print("=" * 55)
    print(f"   📦 Total chunks     : {total}")
    print(f"   ✅ Already embedded : {done}")
    print(f"   🔧 Remaining        : {remaining}")
    print(f"   🤖 Model            : all-MiniLM-L6-v2 (free)")
    print(f"   ⏱️  Est. time        : ~{remaining // 60 + 1} mins")
    print("=" * 55)

    if remaining == 0:
        print("\n🎉 All chunks already embedded!")
        return

    # Load the model only now that there's work to do. On the cloud runner the
    # weights come from the HuggingFace cache (authenticated via HF_TOKEN), so
    # nothing is re-installed each run.
    print("⏳ Loading embedding model...")
    model = SentenceTransformer(MODEL_NAME)
    print("✅ Model loaded!\n")

    processed = failed = 0
    last_id   = 0   # cursor — only fetch still-unembedded chunks with id > last_id
    start     = time.time()

    # Cursor pagination, NOT offset. Embedded chunks drop out of the `is null`
    # filter, so an advancing offset over a shrinking result set silently SKIPS
    # chunks. Filtering by id > last_id and advancing past each batch never skips.
    while True:
        # Fetch chunks without embeddings
        try:
            resp = (
                supabase.table(CHUNK_TABLE)
                .select("id, chunk_text")
                .is_("embedding", "null")
                .gt("id", last_id)
                .order("id")
                .limit(BATCH_SIZE)
                .execute()
            )
            rows = resp.data
        except Exception as e:
            print(f"🔥 Fetch error: {e} — retrying in 5s...")
            time.sleep(5)
            continue

        if not rows:
            break

        # Extract texts and ids
        ids   = [row["id"]         for row in rows]
        texts = [row["chunk_text"] for row in rows]
        last_id = max(ids)  # advance cursor past this batch (success or fail)

        # Generate embeddings in one batch (fast!)
        try:
            embeddings = model.encode(
                texts,
                batch_size=32,
                show_progress_bar=False,
                convert_to_numpy=True
            )
        except Exception as e:
            print(f"🔥 Embedding error: {e}")
            continue

        # Save each embedding to Supabase
        for chunk_id, embedding in zip(ids, embeddings):
            try:
                supabase.table(CHUNK_TABLE).update(
                    {"embedding": embedding.tolist()}
                ).eq("id", chunk_id).execute()

                processed += 1

                # Print progress every 50
                if processed % 50 == 0 or processed <= 5:
                    elapsed = int(time.time() - start)
                    speed   = processed / max(elapsed, 1)
                    eta     = int((remaining - processed) / max(speed, 0.1))
                    print(f"  ✅ [{processed}/{remaining}]  ETA: ~{eta//60}m {eta%60}s")

            except Exception as e:
                print(f"  🔥 Save error for {chunk_id}: {e}")
                failed += 1

    elapsed = int(time.time() - start)
    m, s    = divmod(elapsed, 60)

    print("\n" + "=" * 55)
    print("   📊 EMBEDDING COMPLETE")
    print("=" * 55)
    print(f"   ✅ Embedded : {processed}")
    print(f"   ❌ Failed   : {failed}")
    print(f"   ⏱️  Time     : {m}m {s}s")
    print("=" * 55)
    print("""
⚡ FINAL STEP — Run this SQL in Supabase to speed up search:

    CREATE INDEX ON "MarquesBrownlee_chunks"
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);

This makes search 10x faster!
""")


if __name__ == "__main__":
    main()