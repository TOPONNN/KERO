import os
import json
import re
import gc
import torch

# --- PyTorch 2.8 compatibility patch ---
# WhisperX/pyannote uses omegaconf classes in saved models which
# torch.load(weights_only=True) rejects. Patch to default weights_only=False.
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs.setdefault('weights_only', False)
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

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
        self._whisperx_model = None

    # ------------------------------------------------------------------
    # WhisperX model management
    # ------------------------------------------------------------------

    def _get_whisperx_model(self):
        """Lazy-load WhisperX model (large-v3, float16 on CUDA)."""
        if self._whisperx_model is None:
            import whisperx
            print("[WhisperX] Loading large-v3 model...")
            compute = "float16" if self.device == "cuda" else "int8"
            self._whisperx_model = whisperx.load_model(
                "large-v3", self.device, compute_type=compute
            )
            print("[WhisperX] Model loaded")
        return self._whisperx_model

    def _release_whisperx_model(self):
        """Free WhisperX model to reclaim GPU memory."""
        if self._whisperx_model is not None:
            del self._whisperx_model
            self._whisperx_model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    # ------------------------------------------------------------------
    # Kept verbatim from previous implementation
    # ------------------------------------------------------------------

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
            
            # Process in chunks to avoid CUDA OOM
            chunk_duration = 60  # Larger chunks since tiny model uses less VRAM
            chunk_samples = chunk_duration * sr
            
            all_pitch = []
            all_periodicity = []
            
            for start in range(0, len(audio), chunk_samples):
                chunk = audio[start:start + chunk_samples]
                audio_tensor = torch.tensor(chunk).unsqueeze(0).to(self.device)
                
                pitch_chunk, periodicity_chunk = torchcrepe.predict(
                    audio_tensor,
                    sr,
                    hop_length=320,     # 20ms resolution (sufficient for word-level averages)
                    fmin=65,            # C2 - lowest practical singing note
                    fmax=1047,          # C6 - highest practical singing note
                    model='tiny',       # Fast model, accurate enough for word averages
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
            time = np.arange(len(pitch)) * 320 / sr  # 20ms per frame (matches hop_length)
            
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
        """Add voice activity detection using Silero-VAD neural network."""
        try:
            print(f"[VAD] Loading Silero-VAD model...")
            from silero_vad import load_silero_vad, read_audio, get_speech_timestamps

            vad_model = load_silero_vad()
            wav = read_audio(vocals_path, sampling_rate=16000)

            # Get speech timestamps (in samples at 16kHz)
            speech_timestamps = get_speech_timestamps(
                wav, vad_model,
                sampling_rate=16000,
                threshold=0.3,          # Lower threshold to catch softer singing
                min_speech_duration_ms=100,
                min_silence_duration_ms=50,
            )

            # Convert sample indices to seconds
            speech_ranges = [(ts['start'] / 16000.0, ts['end'] / 16000.0)
                             for ts in speech_timestamps]

            print(f"[VAD] Detected {len(speech_ranges)} speech segments")

            total_words = 0
            vad_added = 0

            for segment in segments:
                for word in segment.get("words", []):
                    total_words += 1
                    start = word.get("start_time", 0)
                    end = word.get("end_time", 0)
                    word_dur = end - start

                    if word_dur <= 0:
                        word["voiced"] = 0.0
                        continue

                    # Calculate overlap with speech segments
                    speech_overlap = 0.0
                    for s_start, s_end in speech_ranges:
                        overlap_start = max(start, s_start)
                        overlap_end = min(end, s_end)
                        if overlap_end > overlap_start:
                            speech_overlap += (overlap_end - overlap_start)

                    voiced = min(1.0, speech_overlap / word_dur)
                    word["voiced"] = round(voiced, 3)
                    vad_added += 1

            print(f"[VAD] Added Silero-VAD values to {vad_added}/{total_words} words")

            # Cleanup
            del vad_model
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            return segments

        except Exception as e:
            print(f"[VAD] Silero-VAD failed: {e}")
            # Fallback: set default
            for segment in segments:
                for word in segment.get("words", []):
                    word["voiced"] = 0.5
            return segments

    # ------------------------------------------------------------------
    # NEW: WhisperX pipeline helpers
    # ------------------------------------------------------------------

    def _build_lines_from_whisperx(self, segments: List[Dict]) -> List[Dict]:
        """Convert WhisperX segments to our output format."""
        lines = []
        for seg in segments:
            words = []
            for w in seg.get("words", []):
                if "start" in w and "end" in w:
                    words.append({
                        "start_time": round(w["start"], 3),
                        "end_time": round(w["end"], 3),
                        "text": w.get("word", w.get("text", "")),
                    })
            if not words and seg.get("text", "").strip():
                # Fallback: segment without word timing
                if "start" in seg and "end" in seg:
                    words = [{
                        "start_time": round(seg["start"], 3),
                        "end_time": round(seg["end"], 3),
                        "text": seg["text"].strip(),
                    }]
            if words:
                words.sort(key=lambda w: w["start_time"])
                lines.append({
                    "start_time": words[0]["start_time"],
                    "end_time": max(w["end_time"] for w in words),
                    "text": " ".join(w["text"] for w in words),
                    "words": words,
                })
        return lines

    def _text_similarity(self, text_a: str, text_b: str) -> float:
        """Jaccard word overlap similarity between two strings."""
        words_a = set(re.sub(r'[^\w\s]', '', text_a.lower()).split())
        words_b = set(re.sub(r'[^\w\s]', '', text_b.lower()).split())
        if not words_a or not words_b:
            return 0.0
        intersection = words_a & words_b
        union = words_a | words_b
        return len(intersection) / len(union) if union else 0.0

    def _merge_with_api_lyrics(self, whisperx_lines: List[Dict], api_lyrics: str) -> List[Dict]:
        """Map clean API text onto WhisperX-timed lines.

        Replaces WhisperX transcription text with clean API text while
        keeping all WhisperX timing information intact.
        """
        api_lines = [line.strip() for line in api_lyrics.split("\n") if line.strip()]
        if not api_lines:
            return whisperx_lines

        # Track which API lines have been used
        used_api = [False] * len(api_lines)

        for wline in whisperx_lines:
            best_score = 0.0
            best_idx = -1

            for i, api_line in enumerate(api_lines):
                if used_api[i]:
                    continue
                score = self._text_similarity(wline["text"], api_line)
                if score > best_score:
                    best_score = score
                    best_idx = i

            if best_idx >= 0 and best_score >= 0.3:
                used_api[best_idx] = True
                api_line_text = api_lines[best_idx]

                # Replace line-level text
                wline["text"] = api_line_text

                # Map API words to WhisperX word timing (positional)
                api_words = api_line_text.split()
                wx_words = wline.get("words", [])

                if api_words and wx_words:
                    if len(api_words) == len(wx_words):
                        # 1:1 mapping — just replace text
                        for aw, ww in zip(api_words, wx_words):
                            ww["text"] = aw
                    else:
                        # Distribute timing proportionally
                        line_start = wx_words[0]["start_time"]
                        line_end = max(w["end_time"] for w in wx_words)
                        total_duration = line_end - line_start
                        if total_duration <= 0:
                            total_duration = 0.5

                        n = len(api_words)
                        word_dur = total_duration / n
                        new_words = []
                        for j, aw in enumerate(api_words):
                            new_words.append({
                                "start_time": round(line_start + j * word_dur, 3),
                                "end_time": round(line_start + (j + 1) * word_dur, 3),
                                "text": aw,
                            })
                        wline["words"] = new_words

        return whisperx_lines

    def _get_whisperx_timing(self, audio_path: str, language: Optional[str] = None) -> Optional[List[Dict]]:
        """Run WhisperX transcription + alignment to get timing info only.
        Returns list of segments with word-level timing, or None if failed."""
        try:
            import whisperx

            model = self._get_whisperx_model()
            audio = whisperx.load_audio(audio_path)

            kwargs: Dict = {"batch_size": 16}
            if language:
                kwargs["language"] = language
            result = model.transcribe(audio, **kwargs)
            detected_lang = result.get("language", language or "en")
            print(f"[WhisperX] Detected language: {detected_lang}")
            print(f"[WhisperX] Got {len(result.get('segments', []))} segments")

            # Word-level alignment
            try:
                model_a, metadata = whisperx.load_align_model(
                    language_code=detected_lang, device=self.device
                )
                result = whisperx.align(
                    result["segments"], model_a, metadata,
                    audio, self.device, return_char_alignments=False
                )
                print(f"[WhisperX] Aligned {len(result.get('segments', []))} segments")
                del model_a
                torch.cuda.empty_cache()
            except Exception as e:
                print(f"[WhisperX] Alignment failed: {e}")

            self._release_whisperx_model()
            return result.get("segments", [])
        except Exception as e:
            print(f"[WhisperX] Failed: {e}")
            self._release_whisperx_model()
            return None

    def _map_api_to_whisperx_timing(self, lyrics_text: str, whisperx_segments: List[Dict]) -> List[Dict]:
        """Map YouTube Music API lyrics lines onto WhisperX timing.

        API lyrics provide the TEXT (official, clean).
        WhisperX provides the TIMING (when each line/word is sung).
        """
        api_lines = [l.strip() for l in lyrics_text.split("\n") if l.strip()]

        # Convert WhisperX segments to our line format (with word timing)
        wx_lines = self._build_lines_from_whisperx(whisperx_segments)

        if not wx_lines:
            # No WhisperX timing — return API lines without timing
            return [{"start_time": 0, "end_time": 0, "text": line, "words": []}
                    for line in api_lines]

        result = []
        used_wx = set()

        for api_line in api_lines:
            # Find best matching WhisperX line by text similarity
            best_idx = -1
            best_score = 0.0
            for i, wx_line in enumerate(wx_lines):
                if i in used_wx:
                    continue
                score = self._text_similarity(api_line, wx_line["text"])
                if score > best_score:
                    best_score = score
                    best_idx = i

            if best_idx >= 0 and best_score >= 0.3:
                used_wx.add(best_idx)
                wx_line = wx_lines[best_idx]

                # Use API text + WhisperX timing
                api_words = api_line.split()
                wx_words = wx_line.get("words", [])

                if api_words and wx_words:
                    if len(api_words) == len(wx_words):
                        # 1:1 — replace text, keep timing
                        mapped_words = []
                        for aw, ww in zip(api_words, wx_words):
                            mapped_words.append({
                                "start_time": ww["start_time"],
                                "end_time": ww["end_time"],
                                "text": aw,
                            })
                    else:
                        # Different word count — distribute timing proportionally
                        line_start = wx_words[0]["start_time"]
                        line_end = max(w["end_time"] for w in wx_words)
                        total_dur = max(line_end - line_start, 0.5)
                        n = len(api_words)
                        word_dur = total_dur / n
                        mapped_words = []
                        for j, aw in enumerate(api_words):
                            mapped_words.append({
                                "start_time": round(line_start + j * word_dur, 3),
                                "end_time": round(line_start + (j + 1) * word_dur, 3),
                                "text": aw,
                            })
                else:
                    mapped_words = [{"start_time": wx_line["start_time"],
                                    "end_time": wx_line["end_time"], "text": api_line}]

                result.append({
                    "start_time": wx_line["start_time"],
                    "end_time": wx_line["end_time"],
                    "text": api_line,
                    "words": mapped_words,
                })
            # else: skip unmatched API lines (section headers like [Verse 1] etc.)

        # Sort by timing
        result.sort(key=lambda l: l["start_time"])
        return result

    def _build_lines_with_mfa_only(self, audio_path: str, lyrics_text: str, language: str) -> List[Dict]:
        """Build lines from API text using MFA-only timing (when WhisperX fails)."""
        mfa_words: List[Dict] = []
        if mfa_processor.is_available() and language in mfa_processor.LANGUAGE_MODELS:
            try:
                clean_text = lyrics_text.replace("\n", " ")
                clean_text = re.sub(r'\[.*?\]', '', clean_text)
                clean_text = re.sub(r'\(.*?\)', '', clean_text)
                clean_text = re.sub(r'[♪~]', '', clean_text)
                clean_text = re.sub(r'\s+', ' ', clean_text).strip()
                mfa_words = mfa_processor.align_lyrics(audio_path, clean_text, language)
                print(f"[MFA-only] Aligned {len(mfa_words)} words")
            except Exception as e:
                print(f"[MFA-only] Failed: {e}")
        return self._build_lines_from_mfa_fallback(lyrics_text, mfa_words)

    def _refine_with_mfa(self, lines: List[Dict], mfa_words: List[Dict]) -> List[Dict]:
        """Average WhisperX and MFA timing for each word."""
        mfa_idx = 0
        for line in lines:
            for word in line.get("words", []):
                # Find matching MFA word by text similarity + time proximity
                clean_w = re.sub(r'[^\w]', '', word["text"].lower())
                for i in range(mfa_idx, min(mfa_idx + 20, len(mfa_words))):
                    clean_m = re.sub(r'[^\w]', '', mfa_words[i]["text"].lower())
                    if clean_w and clean_m and (clean_w == clean_m or clean_w in clean_m or clean_m in clean_w):
                        # Average timing
                        word["start_time"] = round((word["start_time"] + mfa_words[i]["start_time"]) / 2, 3)
                        word["end_time"] = round((word["end_time"] + mfa_words[i]["end_time"]) / 2, 3)
                        mfa_idx = i + 1
                        break
            # Update line timing from words
            if line.get("words"):
                line["start_time"] = line["words"][0]["start_time"]
                line["end_time"] = max(w["end_time"] for w in line["words"])
        return lines

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def extract_lyrics(self, audio_path: str, song_id: str, language: Optional[str] = None,
                       folder_name: Optional[str] = None,
                       title: Optional[str] = None,
                       artist: Optional[str] = None,
                       progress_callback: Optional[Callable[[int], None]] = None) -> Dict:
        if folder_name is None:
            folder_name = song_id

        if progress_callback:
            progress_callback(5)

        # Get audio duration
        try:
            info = sf.info(audio_path)
            duration = info.duration
        except Exception:
            duration = 0

        # ==============================================================
        # Stage 1: Fetch lyrics TEXT from YouTube Music API (PRIMARY)
        # ==============================================================
        print("=" * 60)
        print("[Stage 1: API Lyrics] Fetching lyrics text (primary source)...")
        print("=" * 60)

        lyrics_text = self._fetch_lyrics_from_api(title, artist)

        if not lyrics_text:
            print("[Pipeline] No API lyrics — falling back to WhisperX-only pipeline")
            return self._whisperx_only_pipeline(
                audio_path, song_id, language, folder_name,
                title, artist, progress_callback, duration
            )

        detected_language = self._detect_language(lyrics_text, language, title, artist)
        print(f"[API Lyrics] Language: {detected_language}, {len(lyrics_text)} chars")

        if progress_callback:
            progress_callback(15)

        # ==============================================================
        # Stage 2-3: WhisperX Transcription + Alignment (TIMING ONLY)
        # ==============================================================
        print("=" * 60)
        print("[Stage 2-3: WhisperX] Getting timing from audio...")
        print("=" * 60)

        whisperx_segments = self._get_whisperx_timing(audio_path, language)

        if progress_callback:
            progress_callback(50)

        # ==============================================================
        # Stage 4: Map API lyrics to WhisperX timing
        # ==============================================================
        print("=" * 60)
        print("[Stage 4: Mapping] Mapping API text onto audio timing...")
        print("=" * 60)

        if whisperx_segments:
            lyrics_lines = self._map_api_to_whisperx_timing(lyrics_text, whisperx_segments)
            print(f"[Mapping] {len(lyrics_lines)} lines mapped to WhisperX timing")
        else:
            print("[Mapping] WhisperX failed — using MFA-only timing")
            lyrics_lines = self._build_lines_with_mfa_only(audio_path, lyrics_text, detected_language)
            print(f"[Mapping] {len(lyrics_lines)} lines with MFA timing")

        if progress_callback:
            progress_callback(55)

        # ==============================================================
        # Stage 5: MFA Refinement
        # ==============================================================
        print("=" * 60)
        print("[Stage 5: MFA] Refining word timing...")
        print("=" * 60)

        if whisperx_segments and mfa_processor.is_available() and detected_language in mfa_processor.LANGUAGE_MODELS:
            try:
                # Build clean text for MFA from our current lines
                clean_text = " ".join(line["text"] for line in lyrics_lines)
                clean_text = re.sub(r'\[.*?\]', '', clean_text)
                clean_text = re.sub(r'\(.*?\)', '', clean_text)
                clean_text = re.sub(r'[♪~]', '', clean_text)
                clean_text = re.sub(r'\s+', ' ', clean_text).strip()

                mfa_words = mfa_processor.align_lyrics(audio_path, clean_text, detected_language)
                if mfa_words:
                    print(f"[MFA] Got {len(mfa_words)} words — averaging with WhisperX")
                    lyrics_lines = self._refine_with_mfa(lyrics_lines, mfa_words)
                else:
                    print("[MFA] No words returned — keeping current timing")
            except Exception as e:
                print(f"[MFA] Failed: {e} — keeping current timing")
        else:
            if not whisperx_segments:
                print("[MFA] Already used MFA in mapping step — skipping")
            else:
                print(f"[MFA] Not available for '{detected_language}' — keeping WhisperX timing")

        if progress_callback:
            progress_callback(60)

        # Clean lyrics
        lyrics_lines = self._clean_lyrics(lyrics_lines, detected_language)
        print(f"[Clean] {len(lyrics_lines)} lines after cleaning")

        # ==============================================================
        # Stage 6: Energy analysis
        # ==============================================================
        print("=" * 60)
        print("[Stage 6: Energy] Analyzing vocal intensity...")
        print("=" * 60)

        lyrics_lines = self._add_energy_to_words(audio_path, lyrics_lines)

        # ==============================================================
        # Stage 7: Pitch analysis
        # ==============================================================
        print("=" * 60)
        print("[Stage 7: Pitch] Analyzing vocal melody...")
        print("=" * 60)

        lyrics_lines = self._add_pitch_to_words(audio_path, lyrics_lines)

        # ==============================================================
        # Stage 8: VAD analysis (Silero-VAD)
        # ==============================================================
        print("=" * 60)
        print("[Stage 8: VAD] Detecting voice activity (Silero-VAD)...")
        print("=" * 60)

        lyrics_lines = self._add_vad_to_words(audio_path, lyrics_lines)

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

    # ------------------------------------------------------------------
    # Fallback: WhisperX-only pipeline when API lyrics unavailable
    # ------------------------------------------------------------------

    def _whisperx_only_pipeline(self, audio_path: str, song_id: str,
                                language: Optional[str], folder_name: str,
                                title: Optional[str], artist: Optional[str],
                                progress_callback: Optional[Callable[[int], None]],
                                duration: float) -> Dict:
        """Fallback pipeline when API lyrics unavailable: WhisperX provides both text and timing."""
        print("[WhisperX-only] Running WhisperX-only pipeline (no API lyrics)...")

        whisperx_segments = self._get_whisperx_timing(audio_path, language)

        if not whisperx_segments:
            print("[WhisperX-only] WhisperX also failed — returning empty result")
            return {
                "lyrics_url": "",
                "lyrics": [],
                "full_text": "",
                "language": language or "en",
                "duration": duration,
            }

        if progress_callback:
            progress_callback(50)

        # Build lines from WhisperX (text + timing from transcription)
        lyrics_lines = self._build_lines_from_whisperx(whisperx_segments)
        print(f"[WhisperX-only] {len(lyrics_lines)} lines from transcription")

        # Detect language from WhisperX text
        full_text = " ".join(l["text"] for l in lyrics_lines)
        detected_language = self._detect_language(full_text, language, title, artist)

        # MFA refinement
        if mfa_processor.is_available() and detected_language in mfa_processor.LANGUAGE_MODELS:
            try:
                clean_text = " ".join(line["text"] for line in lyrics_lines)
                clean_text = re.sub(r'\[.*?\]', '', clean_text)
                clean_text = re.sub(r'\(.*?\)', '', clean_text)
                clean_text = re.sub(r'[♪~]', '', clean_text)
                clean_text = re.sub(r'\s+', ' ', clean_text).strip()

                mfa_words = mfa_processor.align_lyrics(audio_path, clean_text, detected_language)
                if mfa_words:
                    print(f"[WhisperX-only MFA] Got {len(mfa_words)} words — averaging")
                    lyrics_lines = self._refine_with_mfa(lyrics_lines, mfa_words)
            except Exception as e:
                print(f"[WhisperX-only MFA] Failed: {e}")

        if progress_callback:
            progress_callback(60)

        # Clean, Energy, Pitch, VAD
        lyrics_lines = self._clean_lyrics(lyrics_lines, detected_language)
        lyrics_lines = self._add_energy_to_words(audio_path, lyrics_lines)
        lyrics_lines = self._add_pitch_to_words(audio_path, lyrics_lines)
        lyrics_lines = self._add_vad_to_words(audio_path, lyrics_lines)

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

    def _build_lines_from_mfa_fallback(self, lyrics_text: str, mfa_words: List[Dict]) -> List[Dict]:
        """Build display lines from API text lines + MFA word timings (fallback path)."""
        raw_lines = [line.strip() for line in lyrics_text.split("\n") if line.strip()]

        if not mfa_words:
            return [{
                "start_time": 0,
                "end_time": 0,
                "text": line,
                "words": []
            } for line in raw_lines]

        mfa_idx = 0
        result_lines = []

        for line_text in raw_lines:
            line_words_text = line_text.split()
            if not line_words_text:
                continue

            line_words = []

            for word_text in line_words_text:
                clean_word = re.sub(r'[^\w\s]', '', word_text).lower().strip()
                if not clean_word:
                    continue

                matched = False
                for i in range(mfa_idx, min(mfa_idx + 20, len(mfa_words))):
                    mfa_word = mfa_words[i]
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
                    if line_words:
                        last_end = line_words[-1]["end_time"]
                    elif result_lines:
                        last_end = result_lines[-1]["end_time"] + 0.1
                    else:
                        last_end = 0.0

                    line_words.append({
                        "start_time": round(last_end, 3),
                        "end_time": round(last_end + 0.3, 3),
                        "text": word_text,
                    })

            if line_words:
                line_words.sort(key=lambda w: w["start_time"])
                line_start = line_words[0]["start_time"]
                line_end = max(w["end_time"] for w in line_words)
                if line_end < line_start:
                    line_end = line_start + 1.0
                result_lines.append({
                    "start_time": line_start,
                    "end_time": line_end,
                    "text": line_text,
                    "words": line_words,
                })

        return result_lines


# Singleton - keep old name as alias for backward compatibility
lyrics_processor = LyricsProcessor()
whisper_processor = lyrics_processor  # backward compat alias
