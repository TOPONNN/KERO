import os
from dotenv import load_dotenv

load_dotenv()

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "localhost")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_USER = os.getenv("RABBITMQ_USER", "guest")
RABBITMQ_PASS = os.getenv("RABBITMQ_PASS", "guest")

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")
S3_BUCKET = os.getenv("S3_BUCKET", "kero-audio")

# Backend API URL for callbacks (use public nginx endpoint)
BACKEND_API_URL = os.getenv("BACKEND_API_URL", "https://kero.ooo")

TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/kero-ai")
os.makedirs(TEMP_DIR, exist_ok=True)

QUEUE_NAMES = {
    "audio_process": "kero.audio.process",
    "lyrics_extract": "kero.lyrics.extract",
    "pitch_analyze": "kero.pitch.analyze",
}
