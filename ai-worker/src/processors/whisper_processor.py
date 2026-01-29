import os
import json
import re
import gc
import torch
import numpy as np
import librosa
import torchcrepe
import requests
import soundfile as sf

from typing import List, Dict, Callable, Optional
from src.config import TEMP_DIR, LYRICS_API_URL
from src.services.s3_service import s3_service
from src.processors.mfa_processor import mfa_processor


class LyricsProcessor:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def _fetch_lyrics_from_api(self, title: Optional[str], artist: Optional[str]) -> Optional[str]:
        if not title:
            return None

        try:
            params = {"title": title}
            if artist:
                params["artist"] = artist

            url = f"{LYRICS_API_URL}/v2/youtube/lyrics"
            print(f"[Lyrics API] Fetching: {url} params={params}")

            response = requests.get(url, params=params, timeout=15)

            if response.status_code == 200:
                data = response.json()
                lyrics_text = data.get("data", {}).get("lyrics")
                # "respone" is the API's actual typo for 404 responses
                if lyrics_text and not data.get("data", {}).get("respone"):
                    lyrics_text = lyrics_text.replace("\r\n", "\n").replace("\r", "\n")
                    print(f"[Lyrics API] Got lyrics: {len(lyrics_text)} chars, track={data['data'].get('trackName')}")
                    return lyrics_text
                else:
                    print(f"[Lyrics API] No lyrics found for: {title} - {artist}")
                    return None
            else:
                print(f"[Lyrics API] HTTP {response.status_code}")
                return None

        except Exception as e:
            print(f"[Lyrics API] Failed: {e}")
            return None

    def _detect_language(self, text: str, language: Optional[str], title: Optional[str], artist: Optional[str]) -> str:
        """Detect language from lyrics text and metadata"""
        if language:
            return language

        # Check metadata for Korean
        korean_pattern = re.compile(r'[\uac00-\ud7af]')
        if title and korean_pattern.search(title):
            return "ko"
        if artist and korean_pattern.search(artist):
            return "ko"

        # Check text content
        korean_chars = len(re.findall(r'[\uac00-\ud7af]', text))
        japanese_chars = len(re.findall(r'[\u3040-\u30ff]', text))
        total_chars = len(re.sub(r'\s', '', text))

        if total_chars > 0:
            if korean_chars / total_chars > 0.2:
                return "ko"
            if japanese_chars / total_chars > 0.2:
                return "ja"

        return "en"

    def _build_lines_from_mfa(self, lyrics_text: str, mfa_words: List[Dict]) -> List[Dict]:
        """Build display lines from API text lines + MFA word timings.

        Maps MFA words to the original API text lines preserving
        the natural line structure from YouTube Music lyrics.
        """
        # Split API lyrics into lines (preserving original structure)
        raw_lines = [line.strip() for line in lyrics_text.split("\n") if line.strip()]

        if not mfa_words:
            # MFA failed - return lines without timing
            return [{
                "start_time": 0,
                "end_time": 0,
                "text": line,
                "words": []
            } for line in raw_lines]

        # Build word queue from MFA output
        mfa_queue = list(mfa_words)  # [{start_time, end_time, text}, ...]
        mfa_idx = 0

        result_lines = []

        for line_text in raw_lines:
            # Split this line into expected words
            line_words_text = line_text.split()
            if not line_words_text:
                continue

            line_words = []

            for word_text in line_words_text:
                # Try to match with next MFA word
                matched = False
                clean_word = re.sub(r'[^\w\s]', '', word_text).lower().strip()

                if not clean_word:
                    continue

                # Search in a window ahead
                for i in range(mfa_idx, min(mfa_idx + 20, len(mfa_queue))):
                    mfa_word = mfa_queue[i]
                    mfa_clean = re.sub(r'[^\w\s]', '', mfa_word["text"]).lower().strip()

                    if (mfa_clean == clean_word or
                        mfa_clean.startswith(clean_word) or
                        clean_word.startswith(mfa_clean) or
                        mfa_clean in clean_word or
                        clean_word in mfa_clean):
                        line_words.append({
                            "start_time": round(mfa_word["start_time"], 3),
                            "end_time": round(mfa_word["end_time"], 3),
                            "text": word_text,
                        })
                        mfa_idx = i + 1
                        matched = True
                        break

                if not matched:
                    # Can't find timing - use interpolated timing or skip
                    # Use last known time + small offset
                    if line_words:
                        last_end = line_words[-1]["end_time"]
                        line_words.append({
                            "start_time": round(last_end, 3),
                            "end_time": round(last_end + 0.3, 3),
                            "text": word_text,
                        })
                    elif result_lines:
                        last_end = result_lines[-1]["end_time"]
                        line_words.append({
                            "start_time": round(last_end + 0.1, 3),
                            "end_time": round(last_end + 0.4, 3),
                            "text": word_text,
                        })

            if line_words:
                result_lines.append({
                    "start_time": line_words[0]["start_time"],
                    "end_time": line_words[-1]["end_time"],
                    "text": line_text,
                    "words": line_words,
                })

        return result_lines

    def _clean_lyrics(self, segments: List[Dict], language: str = "en") -> List[Dict]:
        cleaned = []
        
        youtube_patterns = [
            r'자막|제공|배달의민족|한글자막|시청해주셔서|감사합니다',
            r'광고를.*포함|유료.*광고|PPL',
            r'字幕|提供|感谢观看|订阅|点赞',
            r'字幕|提供|ご視聴|チャンネル登録',
            r'subscribe|like.*comment|thanks.*watching',
            r'다음.*영상|next.*video',
            r'MV|뮤직비디오|music\s*video',
        ]
        youtube_regex = re.compile('|'.join(youtube_patterns), re.IGNORECASE)
        
        dialogue_patterns = [
            r'^(안녕|여보세요|네|아|어|음|응|헐|뭐|왜|어디|언제|누가)',
            r'^(hello|hey|hi|um|uh|yeah|okay|ok|what|why|where)\b',
            r'^\[.*\]$',
            r'^\(.*\)$',
        ]
        dialogue_regex = re.compile('|'.join(dialogue_patterns), re.IGNORECASE)
        
        for segment in segments:
            text = segment["text"]
            
            text = re.sub(r'\[.*?\]', '', text)
            text = re.sub(r'\(.*?\)', '', text)
            text = re.sub(r'(.)\1{4,}', r'\1\1\1', text)
            text = re.sub(r'\s+', ' ', text).strip()
            
            if not text or len(text) < 2:
                continue
            
            if re.match(r'^[♪~\s\.\,]+$', text):
                continue
            
            if youtube_regex.search(text):
                print(f"[Clean] Filtered YouTube pattern: {text[:50]}")
                continue
            
            if len(text) < 10 and dialogue_regex.match(text):
                print(f"[Clean] Filtered dialogue: {text}")
                continue
                
            segment["text"] = text
            
            if segment.get("words"):
                cleaned_words = []
                for word in segment["words"]:
                    word_text = word["text"].strip()
                    if word_text and len(word_text) >= 1:
                        word["text"] = word_text
                        cleaned_words.append(word)
                segment["words"] = cleaned_words
                
                if cleaned_words:
                    segment["text"] = " ".join(w["text"] for w in cleaned_words).strip()
            
            if segment.get("text") and len(segment["text"]) >= 2:
                cleaned.append(segment)
        
        return cleaned

    def _add_energy_to_words(self, vocals_path: str, segments: List[Dict]) -> List[Dict]:
        """Add RMS energy values (0.0-1.0) to each word based on vocal intensity"""
        try:
            print(f"[Energy] Loading vocals from {vocals_path}...")
            y, sr = librosa.load(vocals_path, sr=16000)
            
            # Calculate RMS energy with small hop length for precision
            rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
            times = librosa.times_like(rms, sr=sr, hop_length=512)
            
            # Get global min/max for normalization
            rms_min, rms_max = rms.min(), rms.max()
            rms_range = rms_max - rms_min + 1e-8
            
            total_words = 0
            energy_added = 0
            
            for segment in segments:
                words = segment.get("words", [])
                for word in words:
                    total_words += 1
                    start_time = word.get("start_time", 0)
                    end_time = word.get("end_time", 0)
                    
                    start_idx = np.searchsorted(times, start_time)
                    end_idx = np.searchsorted(times, end_time)
                    
                    if start_idx < end_idx and end_idx <= len(rms):
                        word_rms = rms[start_idx:end_idx].mean()
                        # Normalize to 0-1
                        energy = (word_rms - rms_min) / rms_range
                        word["energy"] = round(float(energy), 3)
                        energy_added += 1
                    else:
                        # Default for very short words or edge cases
                        word["energy"] = 0.5
            
            print(f"[Energy] Added energy values to {energy_added}/{total_words} words")
            return segments
            
        except Exception as e:
            print(f"[Energy] Failed to calculate energy: {e}")
            # Assign default energy values on failure
            for segment in segments:
                for word in segment.get("words", []):
                    word["energy"] = 0.5
            return segments

    def _add_pitch_to_words(self, vocals_path: str, segments: List[Dict]) -> List[Dict]:
        """Add pitch data (frequency, note, midi) to each word based on vocal analysis"""
        try:
            print(f"[Pitch] Loading vocals from {vocals_path}...")
            audio, sr = librosa.load(vocals_path, sr=16000, mono=True)
            
            # Process in chunks to avoid CUDA OOM (30 seconds each)
            chunk_duration = 30
            chunk_samples = chunk_duration * sr
            
            all_pitch = []
            all_periodicity = []
            
            for start in range(0, len(audio), chunk_samples):
                chunk = audio[start:start + chunk_samples]
                audio_tensor = torch.tensor(chunk).unsqueeze(0).to(self.device)
                
                pitch_chunk, periodicity_chunk = torchcrepe.predict(
                    audio_tensor,
                    sr,
                    hop_length=160,     # 10ms resolution
                    fmin=50,
                    fmax=2000,
                    model='full',
                    device=self.device,
                    return_periodicity=True,
                )
                
                all_pitch.append(pitch_chunk.squeeze().cpu().numpy())
                all_periodicity.append(periodicity_chunk.squeeze().cpu().numpy())
                
                del audio_tensor, pitch_chunk, periodicity_chunk
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            
            pitch = np.concatenate(all_pitch)
            periodicity = np.concatenate(all_periodicity)
            time = np.arange(len(pitch)) * 160 / sr  # 10ms per frame
            
            # Helper functions (same as crepe_processor.py)
            def freq_to_midi(freq):
                if freq <= 0 or np.isnan(freq):
                    return 0
                return int(round(69 + 12 * np.log2(freq / 440.0)))
            
            def freq_to_note(freq):
                if freq <= 0 or np.isnan(freq):
                    return ""
                notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
                midi = freq_to_midi(freq)
                return f"{notes[midi % 12]}{(midi // 12) - 1}"
            
            total_words = 0
            pitch_added = 0
            
            for segment in segments:
                for word in segment.get("words", []):
                    total_words += 1
                    start_time = word.get("start_time", 0)
                    end_time = word.get("end_time", 0)
                    
                    start_idx = np.searchsorted(time, start_time)
                    end_idx = np.searchsorted(time, end_time)
                    
                    if start_idx < end_idx and end_idx <= len(pitch):
                        # Only consider frames with good periodicity (voice detected)
                        mask = periodicity[start_idx:end_idx] > 0.5
                        valid_freqs = pitch[start_idx:end_idx][mask]
                        
                        if len(valid_freqs) > 0 and not np.all(np.isnan(valid_freqs)):
                            avg_freq = float(np.nanmean(valid_freqs))
                            word["pitch"] = round(avg_freq, 2)
                            word["note"] = freq_to_note(avg_freq)
                            word["midi"] = freq_to_midi(avg_freq)
                            pitch_added += 1
                            continue
                    
                    # Default values for words where pitch can't be determined
                    word["pitch"] = 0
                    word["note"] = ""
                    word["midi"] = 0
            
            print(f"[Pitch] Added pitch values to {pitch_added}/{total_words} words")
            return segments
            
        except Exception as e:
            print(f"[Pitch] Failed to calculate pitch: {e}")
            for segment in segments:
                for word in segment.get("words", []):
                    word["pitch"] = 0
                    word["note"] = ""
                    word["midi"] = 0
            return segments

    def _add_vad_to_words(self, vocals_path: str, segments: List[Dict]) -> List[Dict]:
        """Add voice activity detection confidence (0.0-1.0) to each word"""
        try:
            print(f"[VAD] Loading vocals from {vocals_path}...")
            y, sr = librosa.load(vocals_path, sr=16000)

            # Compute RMS energy with fine resolution
            rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
            times = librosa.times_like(rms, sr=sr, hop_length=512)

            # Compute spectral flatness (voice has lower flatness than noise)
            flatness = librosa.feature.spectral_flatness(y=y, n_fft=2048, hop_length=512)[0]

            # Dynamic threshold: percentile-based to adapt to different tracks
            rms_threshold = np.percentile(rms, 30)  # bottom 30% = silence

            # Normalize RMS to 0-1 range
            rms_min = rms.min()
            rms_max = rms.max()
            rms_range = rms_max - rms_min + 1e-8
            rms_normalized = (rms - rms_min) / rms_range

            total_words = 0
            vad_added = 0

            for segment in segments:
                for word in segment.get("words", []):
                    total_words += 1
                    start_time = word.get("start_time", 0)
                    end_time = word.get("end_time", 0)

                    start_idx = np.searchsorted(times, start_time)
                    end_idx = np.searchsorted(times, end_time)

                    if start_idx < end_idx and end_idx <= len(rms):
                        # Voice activity = high energy AND low spectral flatness
                        word_rms = rms_normalized[start_idx:end_idx]
                        word_flatness = flatness[start_idx:end_idx]

                        # Energy component: how loud relative to track
                        energy_score = float(np.mean(word_rms))

                        # Flatness component: voice has structure (low flatness)
                        # Invert: 1.0 = very structured (voice), 0.0 = noise-like
                        voice_score = float(1.0 - np.mean(word_flatness))

                        # Combined voiced confidence
                        voiced = round(energy_score * 0.6 + voice_score * 0.4, 3)
                        voiced = max(0.0, min(1.0, voiced))  # clamp

                        word["voiced"] = voiced
                        vad_added += 1
                    else:
                        word["voiced"] = 0.0

            print(f"[VAD] Added voice activity to {vad_added}/{total_words} words")
            return segments

        except Exception as e:
            print(f"[VAD] Failed: {e}")
            for segment in segments:
                for word in segment.get("words", []):
                    word["voiced"] = 0.0
            return segments

    def extract_lyrics(self, audio_path: str, song_id: str, language: Optional[str] = None,
                       folder_name: Optional[str] = None,
                       title: Optional[str] = None,
                       artist: Optional[str] = None,
                       progress_callback: Optional[Callable[[int], None]] = None) -> Dict:
        if folder_name is None:
            folder_name = song_id

        if progress_callback:
            progress_callback(5)

        # ========================================
        # Stage 1: Fetch lyrics from YouTube Music API
        # ========================================
        print("=" * 60)
        print("[Stage 1: Lyrics API] Fetching lyrics text...")
        print("=" * 60)

        lyrics_text = self._fetch_lyrics_from_api(title, artist)

        if not lyrics_text:
            print("[Lyrics API] No lyrics available - cannot proceed")
            # Return empty result
            duration = 0
            try:
                info = sf.info(audio_path)
                duration = info.duration
            except Exception:
                pass
            return {
                "lyrics_url": "",
                "lyrics": [],
                "full_text": "",
                "language": language or "en",
                "duration": duration,
            }

        if progress_callback:
            progress_callback(15)

        # Detect language from lyrics text
        detected_language = self._detect_language(lyrics_text, language, title, artist)
        print(f"[Lyrics] Language: {detected_language}")
        print(f"[Lyrics] Text length: {len(lyrics_text)} chars")

        # Get audio duration
        try:
            info = sf.info(audio_path)
            duration = info.duration
        except Exception:
            duration = 0

        if progress_callback:
            progress_callback(20)

        # ========================================
        # Stage 2: MFA Forced Alignment
        # ========================================
        print("=" * 60)
        print("[Stage 2: MFA] Forced alignment...")
        print("=" * 60)

        mfa_words = []
        if mfa_processor.is_available() and detected_language in mfa_processor.LANGUAGE_MODELS:
            try:
                # Clean text for MFA
                clean_text = lyrics_text.replace("\n", " ")
                clean_text = re.sub(r'\[.*?\]', '', clean_text)
                clean_text = re.sub(r'\(.*?\)', '', clean_text)
                clean_text = re.sub(r'[♪~]', '', clean_text)
                clean_text = re.sub(r'\s+', ' ', clean_text).strip()

                mfa_words = mfa_processor.align_lyrics(audio_path, clean_text, detected_language)
                print(f"[MFA] Aligned {len(mfa_words)} words")
            except Exception as e:
                print(f"[MFA] Failed: {e}")
                mfa_words = []
        else:
            print(f"[MFA] Not available for language '{detected_language}'")

        if progress_callback:
            progress_callback(50)

        # ========================================
        # Stage 3: Build line segments
        # ========================================
        print("=" * 60)
        print("[Stage 3: Build] Creating line segments...")
        print("=" * 60)

        lyrics_lines = self._build_lines_from_mfa(lyrics_text, mfa_words)
        lyrics_lines = self._clean_lyrics(lyrics_lines, detected_language)

        print(f"[Build] Created {len(lyrics_lines)} lines with {sum(len(l.get('words', [])) for l in lyrics_lines)} words")

        if progress_callback:
            progress_callback(60)

        # ========================================
        # Stage 4: Energy analysis
        # ========================================
        print("=" * 60)
        print("[Stage 4: Energy] Analyzing vocal intensity...")
        print("=" * 60)

        vocals_path = os.path.join(TEMP_DIR, song_id, "vocals.wav")
        if os.path.exists(vocals_path):
            lyrics_lines = self._add_energy_to_words(vocals_path, lyrics_lines)
        else:
            print(f"[Energy] Vocals not found at {vocals_path}, using defaults")
            for seg in lyrics_lines:
                for w in seg.get("words", []):
                    w["energy"] = 0.5

        # ========================================
        # Stage 5: Pitch analysis
        # ========================================
        print("=" * 60)
        print("[Stage 5: Pitch] Analyzing vocal melody...")
        print("=" * 60)

        if os.path.exists(vocals_path):
            lyrics_lines = self._add_pitch_to_words(vocals_path, lyrics_lines)
        else:
            for seg in lyrics_lines:
                for w in seg.get("words", []):
                    w["pitch"] = 0
                    w["note"] = ""
                    w["midi"] = 0

        # ========================================
        # Stage 6: VAD analysis
        # ========================================
        print("=" * 60)
        print("[Stage 6: VAD] Detecting voice activity...")
        print("=" * 60)

        if os.path.exists(vocals_path):
            lyrics_lines = self._add_vad_to_words(vocals_path, lyrics_lines)
        else:
            for seg in lyrics_lines:
                for w in seg.get("words", []):
                    w["voiced"] = 0.0

        if progress_callback:
            progress_callback(90)

        gc.collect()
        if self.device == "cuda":
            torch.cuda.empty_cache()

        # Save and upload
        output_dir = os.path.join(TEMP_DIR, song_id)
        os.makedirs(output_dir, exist_ok=True)

        lyrics_path = os.path.join(output_dir, "lyrics.json")
        with open(lyrics_path, "w", encoding="utf-8") as f:
            json.dump(lyrics_lines, f, ensure_ascii=False, indent=2)

        s3_key = f"songs/{folder_name}/lyrics.json"
        lyrics_url = s3_service.upload_file(lyrics_path, s3_key)

        os.remove(lyrics_path)
        try:
            os.rmdir(output_dir)
        except OSError:
            pass

        if progress_callback:
            progress_callback(100)

        full_text = " ".join([line["text"] for line in lyrics_lines])

        return {
            "lyrics_url": lyrics_url,
            "lyrics": lyrics_lines,
            "full_text": full_text,
            "language": detected_language,
            "duration": duration,
        }


# Singleton - keep old name as alias for backward compatibility
lyrics_processor = LyricsProcessor()
whisper_processor = lyrics_processor  # backward compat alias
