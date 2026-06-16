"""
STEP 3 — CHUNKING
=================
Splits clean_content into overlapping chunks → stores in chunks table
No API needed — runs instantly!

pip install supabase
"""
from supabase import create_client
import time

# ─── CONFIG ───────────────────────────────────────────────────────────────────
import os
from dotenv import load_dotenv
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

SOURCE_TABLE = "MarquesBrownlee"
CHUNK_TABLE  = "MarquesBrownlee_chunks"
CONTENT_COL  = "clean_content"

CHUNK_SIZE   = 400   # words per chunk
OVERLAP      = 50    # words overlap between chunks
BATCH_SIZE   = 50
# ──────────────────────────────────────────────────────────────────────────────

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def split_into_chunks(text: str) -> list[str]:
    """Split text into word-based chunks with overlap."""
    words = text.split()
    if not words:
        return []

    chunks = []
    start  = 0

    while start < len(words):
        end   = min(start + CHUNK_SIZE, len(words))
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        if end == len(words):
            break
        start += CHUNK_SIZE - OVERLAP

    return chunks


def main():
    # Get all transcript IDs already in chunks table (for resume)
    print("⏳ Checking progress...")
    chunked_ids = set()
    offset = 0
    while True:
        resp = supabase.table(CHUNK_TABLE).select("transcript_id").order("id").range(offset, offset + 999).execute()
        if not resp.data:
            break
        for row in resp.data:
            chunked_ids.add(str(row["transcript_id"]))
        if len(resp.data) < 1000:
            break
        offset += 1000

    total = supabase.table(SOURCE_TABLE).select("id", count="exact").not_.is_(CONTENT_COL, "null").execute().count
    remaining = total - len(chunked_ids)

    print("=" * 55)
    print("   ✂️  CHUNKING STEP")
    print("=" * 55)
    print(f"   📦 Total transcripts    : {total}")
    print(f"   ✅ Already chunked      : {len(chunked_ids)}")
    print(f"   🔧 Remaining            : {remaining}")
    print(f"   📐 Chunk size           : {CHUNK_SIZE} words")
    print(f"   🔁 Overlap              : {OVERLAP} words")
    print("=" * 55)

    if remaining == 0:
        print("\n🎉 All transcripts already chunked!")
        return

    processed        = 0
    skipped          = 0
    total_chunks_created = 0
    offset           = 0

    while True:
        try:
            resp = (
                supabase.table(SOURCE_TABLE)
                .select(f"id, {CONTENT_COL}")
                .not_.is_(CONTENT_COL, "null")
                .order("id")
                .range(offset, offset + BATCH_SIZE - 1)
                .execute()
            )
            rows = resp.data
        except Exception as e:
            print(f"🔥 Fetch error: {e} — retrying in 5s...")
            time.sleep(5)
            continue

        if not rows:
            break

        for row in rows:
            tid     = row["id"]
            content = (row.get(CONTENT_COL) or "").strip()

            # Skip if already chunked (safe resume)
            if str(tid) in chunked_ids:
                skipped += 1
                continue

            if not content:
                skipped += 1
                continue

            chunks = split_into_chunks(content)

            if not chunks:
                skipped += 1
                continue

            # Build records to insert
            records = [
                {
                    "transcript_id": tid,
                    "chunk_text":    chunk,
                    "chunk_index":   i
                }
                for i, chunk in enumerate(chunks)
            ]

            try:
                supabase.table(CHUNK_TABLE).insert(records).execute()
                processed += 1
                total_chunks_created += len(chunks)
                print(f"  ✅ [{processed}/{remaining}] {str(tid)[:8]}...  →  {len(chunks)} chunks")
            except Exception as e:
                print(f"  🔥 Insert error for {tid}: {e}")

        offset += BATCH_SIZE

    print("\n" + "=" * 55)
    print("   📊 CHUNKING COMPLETE")
    print("=" * 55)
    print(f"   ✅ Transcripts processed : {processed}")
    print(f"   ⏭️  Skipped               : {skipped}")
    print(f"   📄 Total chunks created  : {total_chunks_created}")
    print(f"   📊 Avg chunks/transcript : {total_chunks_created // max(processed, 1)}")
    print("=" * 55)
    print("\n🎉 Chunking done! Ready for Step 4 — Embeddings.\n")


if __name__ == "__main__":
    main()