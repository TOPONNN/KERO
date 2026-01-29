import os
import json
import re
import subprocess
import requests
from typing import Dict, Any, Optional
from src.config import REDIS_HOST, REDIS_PORT, QUEUE_NAMES, TEMP_DIR, BACKEND_API_URL
from src.services.rabbitmq_service import rabbitmq_service
from src.services.s3_service import s3_service
from src.processors.demucs_processor import demucs_processor
from src.processors.whisper_processor import lyrics_processor as whisper_processor
from src.processors.crepe_processor import crepe_processor


def sanitize_folder_name(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', '_', name)
    name = name.strip('._')
    return name[:100] if len(name) > 100 else name

try:
    import redis as redis_lib
except ImportError:
    redis_lib = None


class AIWorker:
    def __init__(self):
        if redis_lib:
            self.redis_client = redis_lib.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        else:
            self.redis_client = None

    def _download_from_youtube(self, video_id: str, song_id: str, folder_name: str) -> Optional[str]:
        output_path = os.path.join(TEMP_DIR, f"{song_id}_original.opus")
        
        try:
            cmd = [
                "yt-dlp",
                f"https://www.youtube.com/watch?v={video_id}",
                "-x",
                "--audio-format", "opus",
                "-o", output_path,
                "--no-playlist",
                "--no-warnings",
            ]
            
            cookies_paths = [
                os.path.expanduser("~/youtube_cookies.txt"),
                os.path.expanduser("~/ai-worker/cookies/youtube.txt"),
                os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "cookies", "youtube.txt"),
                "/app/cookies/youtube.txt",
            ]
            for cookies_path in cookies_paths:
                if os.path.exists(cookies_path):
                    print(f"Using cookies from: {cookies_path}")
                    cmd.extend(["--cookies", cookies_path])
                    break
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            
            if result.returncode != 0:
                print(f"yt-dlp error: {result.stderr}")
                return None
            
            if os.path.exists(output_path):
                s3_key = f"songs/{folder_name}/original.opus"
                s3_service.upload_file(output_path, s3_key)
                return output_path
            
            return None
        except Exception as e:
            print(f"YouTube download error: {e}")
            return None

    def process_audio(self, message: Dict[str, Any]):
        song_id = message.get("songId") or message.get("song_id")
        source = message.get("source", "s3")
        tasks = message.get("tasks", ["separate", "lyrics", "pitch"])
        title = message.get("title", "unknown")
        artist = message.get("artist", "unknown")
        
        folder_name = sanitize_folder_name(f"{title}-{artist}")
        if not folder_name:
            folder_name = song_id

        print(f"Processing song {song_id} ({folder_name}): {tasks}, source: {source}")

        self._update_status(song_id, "processing", "Downloading audio...")

        local_audio_path = None
        
        if source == "youtube" and "download" in tasks:
            video_id = message.get("videoId")
            if video_id:
                self._update_status(song_id, "processing", "Downloading from YouTube...")
                local_audio_path = self._download_from_youtube(video_id, song_id, folder_name)
                if not local_audio_path:
                    self._update_status(song_id, "failed", "Failed to download from YouTube")
                    return
                tasks = [t for t in tasks if t != "download"]
        else:
            audio_s3_key = message.get("audio_s3_key")
            if audio_s3_key:
                local_audio_path = s3_service.download_file(audio_s3_key)
        
        if not local_audio_path:
            self._update_status(song_id, "failed", "No audio source provided")
            return

        results = {"song_id": song_id}

        try:
            if "separate" in tasks:
                self._update_status(song_id, "processing", "음원 분리 중...", step="demucs", progress=0)
                separation_result = demucs_processor.separate(
                    local_audio_path, song_id, folder_name,
                    progress_callback=lambda p: self._update_status(song_id, "processing", f"음원 분리 중... {p}%", step="demucs", progress=p)
                )
                results["separation"] = separation_result

                vocals_path = os.path.join(TEMP_DIR, song_id, "vocals.wav")
                if os.path.exists(vocals_path):
                    local_audio_path = vocals_path

            if "lyrics" in tasks:
                self._update_status(song_id, "processing", "가사 추출 중...", step="whisper", progress=0)
                vocals_path = results.get("separation", {}).get("vocals_url")
                audio_for_lyrics = local_audio_path

                if vocals_path and "vocals.wav" in vocals_path:
                    temp_vocals = os.path.join(TEMP_DIR, f"{song_id}_vocals.wav")
                    s3_service.download_file(f"songs/{folder_name}/vocals.wav", temp_vocals)
                    audio_for_lyrics = temp_vocals

                lyrics_result = whisper_processor.extract_lyrics(
                    audio_for_lyrics,
                    song_id,
                    language=message.get("language"),  # None = auto-detect
                    folder_name=folder_name,
                    title=title,
                    artist=artist,
                    progress_callback=lambda p: self._update_status(song_id, "processing", f"가사 추출 중... {p}%", step="whisper", progress=p)
                )
                results["lyrics"] = lyrics_result

            if "pitch" in tasks:
                self._update_status(song_id, "processing", "음정 분석 중...", step="crepe", progress=0)
                vocals_path = results.get("separation", {}).get("vocals_url")
                audio_for_pitch = local_audio_path

                if vocals_path and "vocals.wav" in vocals_path:
                    temp_vocals = os.path.join(TEMP_DIR, f"{song_id}_vocals.wav")
                    if not os.path.exists(temp_vocals):
                        s3_service.download_file(f"songs/{folder_name}/vocals.wav", temp_vocals)
                    audio_for_pitch = temp_vocals

                pitch_result = crepe_processor.analyze_pitch(
                    audio_for_pitch, song_id, folder_name,
                    progress_callback=lambda p: self._update_status(song_id, "processing", f"음정 분석 중... {p}%", step="crepe", progress=p)
                )
                results["pitch"] = pitch_result

            self._update_status(song_id, "completed", "Processing complete", results)
            self._send_callback_to_backend(song_id, results)
            print(f"Song {song_id} processing complete")

        except Exception as e:
            error_msg = str(e)
            print(f"Error processing song {song_id}: {error_msg}")
            self._update_status(song_id, "failed", error_msg)

        finally:
            self._cleanup_temp_files(song_id)

    def _update_status(self, song_id: str, status: str, message: str, results: Dict = None, step: str = None, progress: int = None):
        status_data = {
            "song_id": song_id,
            "status": status,
            "message": message,
        }
        if results:
            status_data["results"] = results
        if step:
            status_data["step"] = step
        if progress is not None:
            status_data["progress"] = progress

        if self.redis_client:
            self.redis_client.set(f"song:processing:{song_id}", json.dumps(status_data), ex=3600)
            self.redis_client.publish("kero:song:status", json.dumps(status_data))
        print(f"Status update: {song_id} - {status} - {message}" + (f" [{step} {progress}%]" if step and progress is not None else ""))

    def _send_callback_to_backend(self, song_id: str, results: Dict):
        try:
            separation = results.get("separation", {})
            lyrics_result = results.get("lyrics", {})
            
            callback_data = {
                "status": "completed",
                "vocalsUrl": separation.get("vocals_url"),
                "instrumentalUrl": separation.get("instrumental_url"),
                "lyrics": lyrics_result.get("lyrics", []),
                "duration": lyrics_result.get("duration"),
            }
            
            url = f"{BACKEND_API_URL}/api/songs/{song_id}/processing-callback"
            response = requests.post(url, json=callback_data, timeout=30)
            
            if response.status_code == 200:
                print(f"Callback sent successfully for song {song_id}")
            else:
                print(f"Callback failed for song {song_id}: {response.status_code} - {response.text}")
        except Exception as e:
            print(f"Error sending callback for song {song_id}: {e}")

    def _cleanup_temp_files(self, song_id: str):
        temp_dir = os.path.join(TEMP_DIR, song_id)
        if os.path.exists(temp_dir):
            for file in os.listdir(temp_dir):
                os.remove(os.path.join(temp_dir, file))
            os.rmdir(temp_dir)

        for pattern in [f"{song_id}_*", f"*{song_id}*"]:
            for file in os.listdir(TEMP_DIR):
                if song_id in file:
                    try:
                        os.remove(os.path.join(TEMP_DIR, file))
                    except Exception:
                        pass

    def start(self):
        print("AI Worker started. Waiting for messages...")
        rabbitmq_service.consume(QUEUE_NAMES["audio_process"], self.process_audio)


def main():
    worker = AIWorker()
    worker.start()


if __name__ == "__main__":
    main()
