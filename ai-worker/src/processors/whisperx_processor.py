import os
import json
import re
import gc
import uuid
import torch

import numpy as np
import librosa
from torchfcpe import spawn_bundled_infer_model
import requests
import soundfile as sf

from typing import List, Dict, Callable, Optional
from src.config import TEMP_DIR, LYRICS_API_URL, SOFA_MODEL_PATH
from src.services.s3_service import s3_service


class LyricsProcessor:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    # ------------------------------------------------------------------
    # Lyrics fetching and language detection
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

    # ------------------------------------------------------------------
    # Energy and pitch analysis (Stages 5-7)
    # ------------------------------------------------------------------

    def _add_energy_to_words(self, vocals_path: str, segments: List[Dict]) -> List[Dict]:
        """Add RMS energy values (0.0-1.0) to each word based on vocal intensity"""
        try:
            print(f"[Energy] Loading vocals from {vocals_path}...")
            y, sr = librosa.load(vocals_path, sr=16000)
            
            # Calculate RMS energy with small hop length for precision
            rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
            times = librosa.times_like(rms, sr=sr, hop_length=512)
            
            # Windowed normalization to preserve local dynamics
            window_size_frames = int(30 * sr / 512)
            window_size_frames = max(window_size_frames, 1)
            
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
                        center = (start_idx + end_idx) // 2
                        win_start = max(0, center - window_size_frames // 2)
                        win_end = min(len(rms), center + window_size_frames // 2)
                        local_rms = rms[win_start:win_end]
                        local_min = float(local_rms.min()) if len(local_rms) else 0.0
                        local_max = float(local_rms.max()) if len(local_rms) else 1.0
                        local_range = local_max - local_min + 1e-8

                        word_rms_slice = rms[start_idx:end_idx]
                        word_rms = float(word_rms_slice.mean())
                        # Normalize to 0-1 within local window
                        energy = (word_rms - local_min) / local_range
                        word["energy"] = round(float(energy), 3)

                        # Energy contour (4-8 samples) across the word duration
                        if len(word_rms_slice) > 1:
                            n_points = min(6, len(word_rms_slice))
                            indices = np.linspace(0, len(word_rms_slice) - 1, n_points, dtype=int)
                            curve = word_rms_slice[indices]
                            curve_normalized = (curve - local_min) / local_range
                            word["energy_curve"] = [round(float(v), 3) for v in curve_normalized]
                        else:
                            word["energy_curve"] = [round(float(energy), 3)]

                        energy_added += 1
                    else:
                        # Default for very short words or edge cases
                        word["energy"] = 0.5
                        word["energy_curve"] = [0.5]
            
            print(f"[Energy] Added energy values to {energy_added}/{total_words} words")
            return segments
            
        except Exception as e:
            print(f"[Energy] Failed to calculate energy: {e}")
            # Assign default energy values on failure
            for segment in segments:
                for word in segment.get("words", []):
                    word["energy"] = 0.5
                    word["energy_curve"] = [0.5]
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
            
            # Lazy-load FCPE model
            if not hasattr(self, '_fcpe_model'):
                self._fcpe_model = spawn_bundled_infer_model(device=self.device)
            
            for start in range(0, len(audio), chunk_samples):
                chunk = audio[start:start + chunk_samples]
                # FCPE requires [batch, samples, 1] shape
                audio_tensor = torch.from_numpy(chunk).float().unsqueeze(0).unsqueeze(-1).to(self.device)
                
                f0_chunk = self._fcpe_model.infer(
                    audio_tensor,
                    sr=sr,
                    decoder_mode="local_argmax",
                    threshold=0.006,
                    f0_min=65,
                    f0_max=987.77,
                    interp_uv=False,
                )
                
                f0_values = f0_chunk.squeeze().cpu().numpy()
                # FCPE doesn't return confidence; synthesize from voicing
                confidence_values = np.where(f0_values > 0, 1.0, 0.0).astype(np.float32)
                
                # Downsample from 10ms (FCPE default) to 20ms to match original hop_length=320
                all_pitch.append(f0_values[::2])
                all_periodicity.append(confidence_values[::2])
                
                del audio_tensor, f0_chunk
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            
            pitch = np.concatenate(all_pitch)
            periodicity = np.concatenate(all_periodicity)
            time = np.arange(len(pitch)) * 320 / sr  # 20ms per frame (matches hop_length)
            
             # Helper functions (same as fcpe_processor.py, now using FCPE)
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

    # ------------------------------------------------------------------
    # Stage 2: Detect voiced audio range using Silero VAD
    # ------------------------------------------------------------------

    def _detect_vocal_range(self, audio_path: str) -> tuple[float, float]:
        """Detect the start and end of vocal activity using Silero VAD.

        Returns (voice_start_sec, voice_end_sec). Falls back to (0, duration)
        if detection fails.
        """
        try:
            from silero_vad import load_silero_vad, read_audio, get_speech_timestamps

            model = load_silero_vad(onnx=True)
            wav = read_audio(audio_path)
            duration = len(wav) / 16000

            # threshold=0.35: 노래는 speech보다 감지 어려우므로 낮춤
            speech_ts = get_speech_timestamps(
                wav, model,
                threshold=0.35,
                min_speech_duration_ms=200,
                return_seconds=True,
            )

            if not speech_ts:
                print(f"[VAD] No speech detected — using full duration")
                return (0.0, duration)

            voice_start = speech_ts[0]["start"]
            voice_end = speech_ts[-1]["end"]

            print(f"[VAD] Silero detected {len(speech_ts)} segments: {voice_start:.1f}s — {voice_end:.1f}s (duration: {duration:.1f}s)")
            return (voice_start, voice_end)

        except Exception as e:
            print(f"[VAD] Silero VAD failed: {e} — falling back to energy-based")
            try:
                y, sr = librosa.load(audio_path, sr=16000)
                duration = len(y) / sr
                rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
                times = librosa.times_like(rms, sr=sr, hop_length=512)
                threshold = float(rms.max()) * 0.10
                voiced = np.where(rms > threshold)[0]
                if len(voiced) == 0:
                    return (0.0, duration)
                return (float(times[voiced[0]]), float(times[voiced[-1]]))
            except Exception:
                try:
                    info = sf.info(audio_path)
                    return (0.0, info.duration)
                except Exception:
                    return (0.0, 0.0)

    # ------------------------------------------------------------------
    # Stage 3: Proportional line-to-audio mapping
    # ------------------------------------------------------------------

    @staticmethod
    def _count_line_chars(text: str) -> int:
        """Count meaningful characters in a line for proportional timing.
        Korean syllables count as 1, other alphanumeric chars count as 1."""
        count = 0
        for char in text:
            if '\uac00' <= char <= '\ud7a3':  # Hangul syllable
                count += 1
            elif char.isalnum():
                count += 1
        return max(count, 1)

    def _map_lines_proportional(self, lyrics_text: str, audio_start: float, audio_end: float) -> List[Dict]:
        """Map API lyric lines to audio timing using proportional character distribution.

        Distributes lyrics lines across the detected vocal range proportionally
        by character count.

        Args:
            lyrics_text: Full lyrics text with newline-separated lines.
            audio_start: Start of vocal activity in seconds.
            audio_end: End of vocal activity in seconds.

        Returns:
            List of dicts with keys: "start", "end", "text".
        """
        api_lines = [l.strip() for l in lyrics_text.split("\n") if l.strip()]
        if not api_lines:
            return []

        total_duration = max(audio_end - audio_start, 0.5)

        # Calculate character counts for proportional distribution
        char_counts = [self._count_line_chars(line) for line in api_lines]
        total_chars = sum(char_counts)

        # Distribute lines proportionally
        result = []
        current_time = audio_start
        for line, chars in zip(api_lines, char_counts):
            line_duration = total_duration * (chars / total_chars)
            line_start = current_time
            line_end = current_time + line_duration
            result.append({
                "start": round(float(line_start), 3),
                "end": round(float(line_end), 3),
                "text": line,
            })
            current_time = line_end

        return result

    # ------------------------------------------------------------------
    # Stage 5: Energy onset refinement
    # ------------------------------------------------------------------

    def _refine_with_energy_onsets(self, segments: List[Dict], vocals_path: str) -> List[Dict]:
        """Post-process: snap word start times to actual vocal energy onsets."""
        try:
            print(f"[Refine] Loading vocals for energy onset detection...")
            y, sr = librosa.load(vocals_path, sr=16000)

            # Compute onset times using librosa
            onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=256)
            onset_frames = librosa.onset.onset_detect(
                onset_envelope=onset_env, sr=sr, hop_length=256,
                backtrack=True, units='frames'
            )
            onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=256)

            # Compute RMS for silence detection
            rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=256)[0]
            rms_times = librosa.times_like(rms, sr=sr, hop_length=256)

            # Silence threshold: frames below 5% of max RMS are silence
            rms_max = float(rms.max()) if len(rms) > 0 else 1.0
            silence_threshold = rms_max * 0.05

            tolerance = 0.15  # ±150ms snap window
            total_snapped = 0
            total_words = 0

            for segment in segments:
                words = segment.get("words", [])
                line_start = segment["start_time"]
                line_end = segment["end_time"]

                for i, word in enumerate(words):
                    total_words += 1
                    start = word["start_time"]

                    # Find nearest onset within tolerance
                    if len(onset_times) > 0:
                        diffs = np.abs(onset_times - start)
                        min_idx = np.argmin(diffs)
                        if diffs[min_idx] <= tolerance:
                            new_start = float(onset_times[min_idx])
                            # Don't snap before line start or before previous word's end
                            prev_end = words[i - 1]["end_time"] if i > 0 else line_start
                            if new_start >= prev_end:
                                word["start_time"] = round(new_start, 3)
                                total_snapped += 1

                # After snapping starts, adjust end times to be seamless
                for i in range(len(words) - 1):
                    words[i]["end_time"] = words[i + 1]["start_time"]
                # Last word ends at line end
                if words:
                    words[-1]["end_time"] = round(line_end, 3)

            print(f"[Refine] Snapped {total_snapped}/{total_words} word starts to energy onsets")
            return segments

        except Exception as e:
            print(f"[Refine] Energy onset refinement failed: {e}")
            return segments

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
            print("[Pipeline] No API lyrics available — cannot process without lyrics")
            if progress_callback:
                progress_callback(100)
            return {
                "lyrics_url": "",
                "lyrics": [],
                "full_text": "",
                "language": language or "ko",
                "duration": duration,
            }

        detected_language = self._detect_language(lyrics_text, language, title, artist)
        print(f"[API Lyrics] Language: {detected_language}, {len(lyrics_text)} chars")

        if progress_callback:
            progress_callback(15)

        # ==============================================================
        # Stage 2: Detect vocal range (energy-based VAD)
        # ==============================================================
        print("=" * 60)
        print("[Stage 2: VAD] Detecting vocal range from audio energy...")
        print("=" * 60)

        audio_start, audio_end = self._detect_vocal_range(audio_path)

        if progress_callback:
            progress_callback(50)

        # ==============================================================
        # Stage 3: Map API lyrics lines to audio regions (proportional)
        # ==============================================================
        print("=" * 60)
        print("[Stage 3: Mapping] Mapping API lines onto audio timing...")
        print("=" * 60)

        if audio_end > audio_start:
            api_line_segments = self._map_lines_proportional(lyrics_text, audio_start, audio_end)
            print(f"[Mapping] {len(api_line_segments)} lines mapped to audio regions")
        else:
            print("[Mapping] VAD failed — using even line distribution")
            lines = [l.strip() for l in lyrics_text.split("\n") if l.strip()]
            if lines and duration > 0:
                per_line = duration / len(lines)
                api_line_segments = [
                    {"start": round(i * per_line, 3), "end": round((i + 1) * per_line, 3), "text": line}
                    for i, line in enumerate(lines)
                ]
            else:
                api_line_segments = [
                    {"start": 0.0, "end": 0.5, "text": line}
                    for line in (lines or [])
                ]

        if progress_callback:
            progress_callback(55)

        # ==============================================================
        # Stage 4: SOFA Forced Alignment (per-segment)
        # ==============================================================
        print("=" * 60)
        print("[Stage 4: SOFA] Singing-oriented forced alignment...")
        print("=" * 60)

        lyrics_lines = []
        if api_line_segments:
            try:
                from src.processors.sofa_aligner import SOFAAligner, _SOFA_SAMPLE_RATE

                sofa = SOFAAligner(
                    model_path=SOFA_MODEL_PATH or None,
                    device=self.device,
                )

                # Load audio once, then align per-segment
                waveform = sofa._load_audio(audio_path)
                total_samples = len(waveform)
                padding_sec = 2.0
                padding_samples = int(padding_sec * _SOFA_SAMPLE_RATE)
                total_words = 0

                for seg in api_line_segments:
                    seg_text = seg.get("text", "").strip()
                    if not seg_text:
                        continue

                    seg_start = seg.get("start", 0.0)
                    seg_end = seg.get("end", 0.0)

                    # Check if segment contains Korean text — SOFA only handles Korean
                    has_korean = any('\uac00' <= c <= '\ud7a3' for c in seg_text)
                    if not has_korean:
                        # Non-Korean segment (e.g. English lyrics) — use proportional timing
                        words = seg_text.split()
                        n_words = len(words)
                        seg_duration = max(seg_end - seg_start, 0.5)
                        char_counts = [max(1, sum(1 for c in w if c.isalnum())) for w in words]
                        total_ch = sum(char_counts)
                        line_words = []
                        cur = seg_start
                        for w, cc in zip(words, char_counts):
                            w_dur = seg_duration * (cc / total_ch)
                            line_words.append({
                                "text": w,
                                "start_time": round(cur, 3),
                                "end_time": round(cur + w_dur, 3),
                            })
                            cur += w_dur
                        lyrics_lines.append({
                            "text": seg_text,
                            "start_time": round(seg_start, 3),
                            "end_time": round(seg_end, 3),
                            "words": line_words,
                        })
                        continue

                    if seg_end <= seg_start:
                        # No valid timing — use proportional word timing
                        words = seg_text.split()
                        n_words = len(words)
                        word_dur = max(seg_end - seg_start, 0.5) / max(n_words, 1)
                        line_words = []
                        for wi, w in enumerate(words):
                            line_words.append({
                                "text": w,
                                "start_time": round(seg_start + wi * word_dur, 3),
                                "end_time": round(seg_start + (wi + 1) * word_dur, 3),
                            })
                        lyrics_lines.append({
                            "text": seg_text,
                            "start_time": round(seg_start, 3),
                            "end_time": round(seg_end, 3),
                            "words": line_words,
                        })
                        continue

                    # Extract audio chunk with padding
                    chunk_start_sample = max(0, int(seg_start * _SOFA_SAMPLE_RATE) - padding_samples)
                    chunk_end_sample = min(total_samples, int(seg_end * _SOFA_SAMPLE_RATE) + padding_samples)
                    chunk_waveform = waveform[chunk_start_sample:chunk_end_sample]
                    time_offset = chunk_start_sample / _SOFA_SAMPLE_RATE

                    try:
                        seg_words = sofa._align_single(chunk_waveform, seg_text)
                    except Exception as seg_e:
                        print(f"[SOFA] Segment error for '{seg_text[:30]}...': {seg_e}")
                        seg_words = []

                    if seg_words:
                        # Offset timestamps by chunk start position
                        line_words = []
                        for w in seg_words:
                            line_words.append({
                                "text": w["text"],
                                "start_time": round(w["start_time"] + time_offset, 3),
                                "end_time": round(w["end_time"] + time_offset, 3),
                            })
                        lyrics_lines.append({
                            "text": seg_text,
                            "start_time": line_words[0]["start_time"],
                            "end_time": line_words[-1]["end_time"],
                            "words": line_words,
                        })
                        total_words += len(line_words)
                    else:
                        # Fallback: proportional word timing within segment bounds
                        words = seg_text.split()
                        n_words = len(words)
                        seg_duration = max(seg_end - seg_start, 0.5)
                        char_counts = [max(1, sum(1 for c in w if '\uac00' <= c <= '\ud7a3' or c.isalnum())) for w in words]
                        total_ch = sum(char_counts)
                        line_words = []
                        cur = seg_start
                        for w, cc in zip(words, char_counts):
                            w_dur = seg_duration * (cc / total_ch)
                            line_words.append({
                                "text": w,
                                "start_time": round(cur, 3),
                                "end_time": round(cur + w_dur, 3),
                            })
                            cur += w_dur
                        lyrics_lines.append({
                            "text": seg_text,
                            "start_time": round(seg_start, 3),
                            "end_time": round(seg_end, 3),
                            "words": line_words,
                        })

                sofa.release_model()
                print(f"[SOFA] Aligned {total_words} words across {len(lyrics_lines)} lines (per-segment)")

            except Exception as e:
                print(f"[SOFA] Error: {e} — using proportional timing fallback")
                # Fallback: proportional word timing for all lines
                for seg in api_line_segments:
                    seg_text = seg.get("text", "").strip()
                    if not seg_text:
                        continue
                    seg_start = seg.get("start", 0.0)
                    seg_end = seg.get("end", 0.0)
                    words = seg_text.split()
                    n_words = len(words)
                    seg_duration = max(seg_end - seg_start, 0.5)
                    word_dur = seg_duration / max(n_words, 1)
                    line_words = []
                    for wi, w in enumerate(words):
                        line_words.append({
                            "text": w,
                            "start_time": round(seg_start + wi * word_dur, 3),
                            "end_time": round(seg_start + (wi + 1) * word_dur, 3),
                        })
                    lyrics_lines.append({
                        "text": seg_text,
                        "start_time": round(seg_start, 3),
                        "end_time": round(seg_end, 3),
                        "words": line_words,
                    })
        else:
            print("[Alignment] No line segments available for alignment")

        if progress_callback:
            progress_callback(60)

        # Clean lyrics
        lyrics_lines = self._clean_lyrics(lyrics_lines, detected_language)
        print(f"[Clean] {len(lyrics_lines)} lines after cleaning")

        # ==============================================================
        # Stage 5: Energy onset refinement (snap word starts to audio)
        # ==============================================================
        print("=" * 60)
        print("[Stage 5: Refine] Snapping word times to energy onsets...")
        print("=" * 60)

        lyrics_lines = self._refine_with_energy_onsets(lyrics_lines, audio_path)

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



# Singleton
lyrics_processor = LyricsProcessor()
