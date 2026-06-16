"""
STEP 4 — EMBEDDINGS
====================
Converts chunk_text → vector using free local model
Model: all-MiniLM-L6-v2 (384 dimensions, excellent quality)
No API needed — runs 100% on your machine!

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

print("⏳ Loading embedding model (first time downloads ~500MB)...")
model    = SentenceTransformer("all-MiniLM-L6-v2")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
print("✅ Model loaded!\n")


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
        for i, (chunk_id, embedding) in enumerate(zip(ids, embeddings)):
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