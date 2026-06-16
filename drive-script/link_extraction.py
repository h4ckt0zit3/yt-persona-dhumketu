import gspread
from gspread.exceptions import SpreadsheetNotFound
from oauth2client.service_account import ServiceAccountCredentials
import subprocess
import json
import time
import os
import csv
import traceback

# 🔥 YOUR CHANNEL LIST (populated from user request)
channel_urls = [
    "https://youtube.com/@PracticalEngineeringChannel",
    "https://youtube.com/@caseyneistat",
    "https://youtube.com/@MrBeast",
    "https://youtube.com/@YesTheory",
    "https://youtube.com/@DavidDobrik",
    "https://youtube.com/@SafiyaNygaard",
    "https://youtube.com/@NasDaily",
    "https://youtube.com/@AbroadinJapan",
    "https://youtube.com/@smosh",
    "https://youtube.com/@DudePerfect",
    "https://youtube.com/@WatchMojo",
    "https://youtube.com/@penguinz0",
    "https://youtube.com/@MichaelReeves",
    "https://youtube.com/@theneedledrop",
    "https://youtube.com/@ToddintheShadows",
    "https://youtube.com/@Polyphonic",
    "https://youtube.com/@MySelfReliance",
    "https://youtube.com/@PaulKirtleyOutdoor",
    "https://youtube.com/@steve1989MREinfo",
    "https://youtube.com/@RyansWorld",
    "https://youtube.com/@Blippi",
    "https://youtube.com/@msrachelfortoddlers",
    "https://youtube.com/@TomScottGo",
    "https://youtube.com/@lewlater",
    "https://youtube.com/@GSMArena",
    "https://youtube.com/@technobuffalo",
    "https://youtube.com/@Nerdstalgic",
    "https://youtube.com/@SSSniperWolf",
    "https://youtube.com/@SmartHomeSolver",
    "https://youtube.com/@flossycarter",
    "https://youtube.com/@iFixit",
]

# 🔑 GOOGLE AUTH
scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive"
]

creds = ServiceAccountCredentials.from_json_keyfile_name("creds.json", scope)
client = gspread.authorize(creds)

# 📂 GOOGLE DRIVE FOLDER ID (The "Youtube Personas" folder)
FOLDER_ID = "1S9lQM3bvY_liaBzvJxurB6E8g5k-HQQx"

# Path to yt-dlp (configurable)
YTDLP_PATH = os.environ.get("YTDLP_PATH", r"C:\\Users\\HP\\yt-dlp.exe")




def normalize_channel_url(url: str) -> str:
    url = url.strip()
    if url.endswith("/"):
        url = url[:-1]
    if url.startswith("http://"):
        url = url.replace("http://", "https://", 1)
    return url


def run_yt_dlp(target_url: str) -> dict:
    cmd = [YTDLP_PATH, "--flat-playlist", "-J", target_url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


#  PROCESS ALL CHANNELS
for raw_url in channel_urls:
    url = normalize_channel_url(raw_url)
    try:
        channel_name = "Unknown Channel"
        videos = []

        # ✅ Target Videos and Shorts only
        for tab in ["/videos", "/shorts"]:
            target_url = f"{url}{tab}"
            print(f"Processing: {target_url}")

            try:
                data = run_yt_dlp(target_url)
            except Exception as e:
                print(f"   ⚠️ yt-dlp failed for {target_url}: {e}")
                continue

            # Extract channel name and strip tab suffixes
            c_name = data.get("title", "Unknown Channel")
            for suffix in [" - Videos", " - Shorts"]:
                if c_name.endswith(suffix):
                    c_name = c_name[:-len(suffix)]

            if c_name != "Unknown Channel":
                channel_name = c_name

            entries = data.get("entries") or []
            # Filter out None entries
            entries = [e for e in entries if e]
            videos.extend(entries)

            time.sleep(1)

        # Extract handle from the URL (the part after '@') and use it for sheet/file names
        handle = url.split('@')[-1].split('/')[0]
        # 🛡️ FALLBACK: If yt-dlp couldn't find the title, keep the handle as channel_name
        if channel_name == "Unknown Channel":
            channel_name = handle

        # Use the handle itself as the spreadsheet name (matches existing sheets)
        sheet_name = handle

        # ✅ OPEN SHEET
        try:
            spreadsheet = client.open(sheet_name)
            sheet = spreadsheet.sheet1

            # 🧹 DELETE EXTRA TABS: Clean up any old tabs
            for ws in spreadsheet.worksheets()[1:]:
                spreadsheet.del_worksheet(ws)
                print(f"   🗑️ Deleted old extra tab: {ws.title}")
                time.sleep(1)
        except SpreadsheetNotFound:
            print(f"➕ '{sheet_name}' not found. Creating it in the 'Youtube Personas' folder...")
            try:
                spreadsheet = client.create(sheet_name, folder_id=FOLDER_ID)
                sheet = spreadsheet.sheet1
                time.sleep(2)
            except Exception as e:
                print(f"❌ Failed to create '{sheet_name}': {e}")
                traceback.print_exc()
                continue

        # CLEAR + HEADER
        try:
            sheet.clear()
            sheet.append_row(["Video Title", "URL", "Published At", "Views", "Likes", "Comments", "Channel"])
        except Exception as e:
            print(f"Warning: unable to clear/append header to Google Sheet: {e}")
            traceback.print_exc()

        # PREPARE DATA
        rows = []
        for video in videos:
            title = video.get("title", "")
            video_id = video.get("id", "")

            if not video_id:
                continue

            link = f"https://www.youtube.com/watch?v={video_id}"

            views = video.get("view_count", "N/A")
            likes = video.get("like_count", "N/A")
            comments = video.get("comment_count", "N/A")

            # Format upload date (yt-dlp usually returns YYYYMMDD like "20240315")
            published = video.get("upload_date", "N/A")
            if published and len(published) == 8:
                published = f"{published[:4]}-{published[4:6]}-{published[6:]}"

            rows.append([title, link, published or "N/A", views, likes, comments, channel_name])

        # 🚀 UPLOAD TO SHEET
        try:
            if rows:
                sheet.append_rows(rows)
        except Exception as e:
            print(f"Warning: failed to append rows to Google Sheet: {e}")
            traceback.print_exc()

        print(f"✅ Done: {sheet_name} (videos: {len(rows)})")

    except Exception as e:
        print(f"❌ Error processing {url}: {e}")
        traceback.print_exc()

print("🎉 ALL CHANNELS COMPLETED (script finished)")