"""
Apify YouTube Transcript → Supabase (Fixed URL List)
=====================================================
Requirements:
  pip install apify-client supabase
"""

import os
from apify_client import ApifyClient
from supabase import create_client, ClientOptions
import time
from pathlib import Path
from urllib.parse import urlparse

# ─── CONFIG ───────────────────────────────────────────────────────────────────
import os
from dotenv import load_dotenv
load_dotenv()
APIFY_API_TOKEN = os.getenv("APIFY_API_TOKEN")
SUPABASE_URL    = os.getenv("SUPABASE_URL")
SUPABASE_KEY    = os.getenv("SUPABASE_KEY")
SUPABASE_TABLE  = "MarquesBrownlee"
URL_FILE        = "urls.txt"
RUN_TEST_URLS   = True   # Set to False to process all URLs from urls.txt
TEST_URL_COUNT  = 3
# ──────────────────────────────────────────────────────────────────────────────

def get_supabase_client():
    if not SUPABASE_URL:
        raise ValueError(
            "Supabase URL is missing. Set SUPABASE_URL in environment variables or in apify_to_supabase.py."
        )
    if not SUPABASE_KEY:
        raise ValueError(
            "Supabase key is missing. Set SUPABASE_KEY in environment variables or in apify_to_supabase.py. "
            "Use a valid anon or service_role API key from your Supabase project."
        )
    
    # Increase timeout to 120 seconds to prevent WinError 10060 on large transcripts
    opts = ClientOptions(postgrest_client_timeout=120.0)
    return create_client(SUPABASE_URL, SUPABASE_KEY, options=opts)


def normalize_url(raw_url: str) -> str:
    url = raw_url.strip()
    if url.endswith(','):
        url = url[:-1].strip()
    if len(url) >= 2 and url[0] in {'"', "'"} and url[-1] == url[0]:
        url = url[1:-1].strip()
    url = url.strip()

    if url.startswith("https://youtu.be/"):
        url = "https://www.youtube.com/watch?v=" + url.split("/")[-1]

    return url


def is_valid_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def load_urls(path: str = URL_FILE) -> list[str]:
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"URL file not found: {path}")

    urls = []
    for line in file_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        line = normalize_url(line)
        if not is_valid_url(line):
            print(f"Skipping invalid URL: {line}")
            continue
        urls.append(line)

    return urls


urls = load_urls()
URL_LIST = urls[:TEST_URL_COUNT] if RUN_TEST_URLS else urls


def main():
    # 1. Run Apify actor
    client = ApifyClient(APIFY_API_TOKEN)
    print(f"Scraping {len(URL_LIST)} videos...")

    run_input = {
        "urls": [{"url": url} for url in URL_LIST],
        "languages": ["en"],
    }

    run = client.actor("supreme_coder/youtube-transcript-scraper").call(
        run_input=run_input
    )

    items = list(client.dataset(run.default_dataset_id).iterate_items())
    print(f"Got {len(items)} results\n")

    # 2. Upload to Supabase
    sb = get_supabase_client()
    success = 0

    for item in items:
        segments = item.get("transcript", [])
        if not segments:
            print(f"  ⚠ No transcript — {item.get('inputUrl', '')}")
            continue

        raw_text = " ".join(seg.get("text", "") for seg in segments)

        title = (
            item.get("videoDetails", {}).get("title")
            or item.get("title")
            or item.get("inputUrl", "unknown")
        )

        # Retry mechanism for Supabase insertion to handle network timeouts
        max_retries = 5
        for attempt in range(max_retries):
            try:
                sb.table(SUPABASE_TABLE).insert(
                    {"file_name": title, "content": raw_text}
                ).execute()
                success += 1
                print(f"  ✓ {title[:70]}")
                break
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = 3 ** attempt
                    print(f"  ⚠ Connection issue, retrying in {wait_time}s... ({e})")
                    time.sleep(wait_time)
                else:
                    print(f"  ✗ Failed after {max_retries} attempts: {e}")

        time.sleep(0.5)

    print(f"\nDone! {success}/{len(items)} videos uploaded.")


if __name__ == "__main__":
    main()