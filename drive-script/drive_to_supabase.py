import os
import time
from supabase import create_client, Client
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from tqdm import tqdm

# =========================
# CONFIG
# =========================
import os
from dotenv import load_dotenv
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

FOLDER_ID = "1fb3ftQE17cfgp5_DZVnNK441pvs5kCRh"
CLIENT_SECRET_FILE = "client_secret.json"

BATCH_SIZE = 20   # safe batch size
SLEEP_TIME = 0.2  # avoid rate limit

# =========================
# AUTH (OAuth)
# =========================
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

flow = InstalledAppFlow.from_client_secrets_file(
    CLIENT_SECRET_FILE, SCOPES
)

creds = flow.run_local_server(port=0)
drive_service = build('drive', 'v3', credentials=creds)

# =========================
# SUPABASE
# =========================
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# =========================
# GET FILES (WITH PAGINATION)
# =========================
def get_all_files(folder_id):
    files = []
    page_token = None

    while True:
        response = drive_service.files().list(
            q=f"'{folder_id}' in parents and mimeType='text/plain'",
            fields="nextPageToken, files(id, name)",
            pageToken=page_token
        ).execute()

        files.extend(response.get('files', []))
        page_token = response.get('nextPageToken')

        if not page_token:
            break

    return files

# =========================
# READ FILE CONTENT
# =========================
def read_file(file_id):
    request = drive_service.files().get_media(fileId=file_id)
    return request.execute().decode('utf-8', errors='ignore')

# =========================
# CHECK EXISTING FILES
# =========================
def get_existing_files():
    response = supabase.table("transcriptions").select("file_name").execute()
    return set([item['file_name'] for item in response.data])

# =========================
# BATCH INSERT
# =========================
def batch_insert(data_batch):
    try:
        supabase.table("transcriptions").insert(data_batch).execute()
    except Exception as e:
        print(f"Batch insert error: {e}")

# =========================
# MAIN
# =========================
def main():
    print("🔍 Fetching files from Drive...")
    files = get_all_files(FOLDER_ID)
    print(f"📁 Total files found: {len(files)}")

    print("📦 Fetching existing records from Supabase...")
    existing_files = get_existing_files()
    print(f"✅ Already uploaded: {len(existing_files)}")

    batch = []
    processed = 0

    for file in tqdm(files):
        file_name = file['name']

        if file_name in existing_files:
            continue

        try:
            content = read_file(file['id'])

            batch.append({
                "file_name": file_name,
                "content": content
            })

            if len(batch) >= BATCH_SIZE:
                batch_insert(batch)
                batch.clear()

            processed += 1
            time.sleep(SLEEP_TIME)

        except Exception as e:
            print(f"❌ Error with {file_name}: {str(e)}")

    # Insert remaining
    if batch:
        batch_insert(batch)

    print(f"\n🎉 Done! Uploaded {processed} new files")

# =========================
# RUN
# =========================
if __name__ == "__main__":
    main()