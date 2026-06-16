"""
INGEST ONE CHANNEL — Apify (channel → videos → transcripts) → Supabase
======================================================================
Parameterised per-channel ingest, dispatched by the app's per-row "Ingest"
button via the ingest-channel.yml GitHub Action.

Env (set from the workflow inputs):
  CHANNEL_URL  - YouTube channel URL                       (required)
  CHANNEL_ID   - app channel id, e.g. CH001 (tags every row, required)
  MAX_VIDEOS   - cap on videos to ingest                   (default 50)

Every stored row is tagged channel_id=CHANNEL_ID so the chat can scope
retrieval to one creator. clean_data / chunking.py / embedding.py then process
the new rows (they only touch unprocessed rows, so this is incremental).
"""
import os
import time
from apify_client import ApifyClient
from supabase import create_client, ClientOptions
from dotenv import load_dotenv

load_dotenv()

APIFY_API_TOKEN = os.getenv("APIFY_API_TOKEN")
SUPABASE_URL    = os.getenv("SUPABASE_URL")
SUPABASE_KEY    = os.getenv("SUPABASE_KEY")
SUPABASE_TABLE  = "MarquesBrownlee"

CHANNEL_URL = (os.getenv("CHANNEL_URL") or "").strip()
CHANNEL_ID  = (os.getenv("CHANNEL_ID") or "").strip()
MAX_VIDEOS  = int(os.getenv("MAX_VIDEOS") or "50")

VIDEO_ACTOR      = "streamers/youtube-scraper"
TRANSCRIPT_ACTOR = "supreme_coder/youtube-transcript-scraper"


def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("SUPABASE_URL / SUPABASE_KEY missing in environment.")
    return create_client(SUPABASE_URL, SUPABASE_KEY, options=ClientOptions(postgrest_client_timeout=120.0))


def is_watch_url(url: str) -> bool:
    return ("watch?v=" in url) or ("youtu.be/" in url)


def load_existing_titles(sb) -> set:
    """Titles already stored for THIS channel — so re-ingesting skips duplicates."""
    titles, start, page = set(), 0, 1000
    while True:
        resp = (
            sb.table(SUPABASE_TABLE)
            .select("file_name")
            .eq("channel_id", CHANNEL_ID)
            .range(start, start + page - 1)
            .execute()
        )
        rows = resp.data or []
        for r in rows:
            if r.get("file_name"):
                titles.add(r["file_name"])
        if len(rows) < page:
            break
        start += page
    return titles


def get_channel_video_urls(client) -> list:
    """Scrape the channel's long-form video URLs (Shorts excluded via the actor)."""
    run_input = {
        "startUrls": [{"url": CHANNEL_URL}],
        "maxResults": MAX_VIDEOS,
        "maxResultStreams": 0,
        "maxResultsShorts": 0,
        "proxy": {"useApifyProxy": True, "apifyProxyGroups": ["RESIDENTIAL"]},
    }
    run = client.actor(VIDEO_ACTOR).call(run_input=run_input)
    urls = []
    for item in client.dataset(run.default_dataset_id).iterate_items():
        url = item.get("url") or item.get("videoUrl") or item.get("link")
        if url and is_watch_url(url) and url not in urls:
            urls.append(url)
    return urls[:MAX_VIDEOS]


def main():
    if not CHANNEL_URL or not CHANNEL_ID:
        raise SystemExit("CHANNEL_URL and CHANNEL_ID env vars are required.")

    client = ApifyClient(APIFY_API_TOKEN)
    print(f"📺 Channel {CHANNEL_ID}: {CHANNEL_URL}  (max {MAX_VIDEOS} videos)")

    print("  → scraping channel video list...")
    video_urls = get_channel_video_urls(client)
    print(f"  → {len(video_urls)} videos found")
    if not video_urls:
        print("  ⚠ No videos found — nothing to ingest.")
        return

    print("  → scraping transcripts...")
    run = client.actor(TRANSCRIPT_ACTOR).call(
        run_input={"urls": [{"url": u} for u in video_urls], "languages": ["en"]}
    )
    items = list(client.dataset(run.default_dataset_id).iterate_items())
    print(f"  → {len(items)} transcript results\n")

    sb = get_supabase()
    existing = load_existing_titles(sb)
    success = skipped = 0

    for item in items:
        segments = item.get("transcript", [])
        if not segments:
            continue
        raw_text = " ".join(seg.get("text", "") for seg in segments)
        vd = item.get("videoDetails", {}) or {}
        title = vd.get("title") or item.get("title") or item.get("inputUrl", "unknown")
        channel_name = vd.get("author") or ""

        if title in existing:
            skipped += 1
            continue

        for attempt in range(5):
            try:
                sb.table(SUPABASE_TABLE).insert({
                    "file_name": title,
                    "content": raw_text,
                    "channel_id": CHANNEL_ID,
                    "channel_name": channel_name,
                }).execute()
                success += 1
                existing.add(title)
                print(f"  ✓ {title[:70]}")
                break
            except Exception as e:
                if attempt < 4:
                    time.sleep(3 ** attempt)
                else:
                    print(f"  ✗ {title[:50]}: {e}")
        time.sleep(0.3)

    print(f"\nDone! {success} stored, {skipped} duplicates skipped for {CHANNEL_ID}.")


if __name__ == "__main__":
    main()
