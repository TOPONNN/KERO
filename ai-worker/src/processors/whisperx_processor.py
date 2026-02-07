import os
import json
import re
import gc
import torch
import unicodedata

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




    def _is_hangul_syllable(self, char: str) -> bool:
        return "\uac00" <= char <= "\ud7a3"

    def _strip_for_match(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKC", text or "")
        stripped = []
        for char in normalized:
            if char.isspace():
                continue
            category = unicodedata.category(char)
            if category.startswith("P") or category.startswith("S"):
                continue
            stripped.append(char)
        return "".join(stripped)

    def _extract_syllables(self, text: str) -> List[str]:
        stripped = self._strip_for_match(text)
        syllables = []
        for char in stripped:
            if self._is_hangul_syllable(char):
                syllables.append(char)
            elif char.isalnum():
                syllables.append(char.lower())
        return syllables

    def _count_chars(self, text: str) -> int:
        return len(self._extract_syllables(text))



    def _build_word_timings(self, line_text: str, line_start: float, line_end: float) -> List[Dict]:
        words = line_text.split()
        if not words:
            return []

        char_counts = [max(1, self._count_chars(word)) for word in words]
        total_chars = sum(char_counts)
        duration = max(line_end - line_start, 0.5)
        word_timings = []
        char_offset = 0
        for word, chars in zip(words, char_counts):
            start = line_start + (char_offset / total_chars) * duration
            end = line_start + ((char_offset + chars) / total_chars) * duration
            word_timings.append({
                "start_time": round(start, 3),
                "end_time": round(end, 3),
                "text": word,
            })
            char_offset += chars
        return word_timings



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
                # Last word: keep its own end_time (don't override with original segment boundary)
                # This prevents line/word end_time divergence

                # Recompute line boundaries from the finalized words
                if words:
                    segment["start_time"] = words[0]["start_time"]
                    segment["end_time"] = words[-1]["end_time"]

            print(f"[Refine] Snapped {total_snapped}/{total_words} word starts to energy onsets")
            return segments

        except Exception as e:
            print(f"[Refine] Energy onset refinement failed: {e}")
            return segments






    def _group_words_into_lines(self, all_words: List[Dict], lyrics_text: str) -> List[Dict]:
        """Group SOFA flat word list into lines based on the original lyrics text.

        SOFA's G2P tokenizes by whitespace (spaces AND newlines), so the returned
        word list is a flat sequence corresponding to ``lyrics_text.split()``.
        This method re-groups them by the original ``\\n``-delimited lines.

        If SOFA skipped some words (e.g. pure-punctuation), the cursor simply
        advances past them and assigns proportional fallback timing.
        """
        lines = [l.strip() for l in lyrics_text.split("\n") if l.strip()]
        if not lines:
            return []

        lyrics_lines: List[Dict] = []
        word_cursor = 0

        for line_text in lines:
            expected_words = line_text.split()
            line_words: List[Dict] = []

            for expected_word in expected_words:
                if word_cursor < len(all_words):
                    w = all_words[word_cursor]
                    line_words.append({
                        "text": expected_word,
                        "start_time": round(w["start_time"], 3),
                        "end_time": round(w["end_time"], 3),
                    })
                    word_cursor += 1
                else:
                    # SOFA ran out of aligned words — assign placeholder
                    if line_words:
                        last_end = line_words[-1]["end_time"]
                    elif lyrics_lines and lyrics_lines[-1]["words"]:
                        last_end = lyrics_lines[-1]["words"][-1]["end_time"]
                    else:
                        last_end = 0.0
                    line_words.append({
                        "text": expected_word,
                        "start_time": round(last_end, 3),
                        "end_time": round(last_end + 0.3, 3),
                    })

            if line_words:
                lyrics_lines.append({
                    "text": line_text,
                    "start_time": line_words[0]["start_time"],
                    "end_time": line_words[-1]["end_time"],
                    "words": line_words,
                })

        return lyrics_lines



    def _enforce_monotonic_lines(self, lyrics_lines: List[Dict]) -> List[Dict]:
        """Ensure all line boundaries are monotonically increasing (no overlaps).

        For each line in order:
        1. Recompute line start/end from its words
        2. Clamp line.start >= prev_line.end
        3. Proportionally redistribute words if line was compressed
        """
        if not lyrics_lines:
            return lyrics_lines

        prev_end = 0.0
        overlap_count = 0

        for idx, line in enumerate(lyrics_lines):
            words = line.get("words", [])

            # Recompute line boundaries from word data
            if words:
                line["start_time"] = words[0]["start_time"]
                line["end_time"] = words[-1]["end_time"]

            line_start = line["start_time"]
            line_end = line["end_time"]

            # Detect overlap
            if line_start < prev_end:
                overlap_count += 1
                old_start = line_start
                line_start = prev_end
                line["start_time"] = round(line_start, 3)

                # If end is also before prev_end, push it forward
                if line_end <= line_start:
                    # Preserve original duration as much as possible
                    original_dur = max(line_end - old_start, 0.5)
                    line_end = line_start + original_dur
                    line["end_time"] = round(line_end, 3)

                # Redistribute words within the new boundaries
                if words:
                    line_dur = max(line_end - line_start, 0.1)
                    total_chars = sum(max(1, self._count_chars(w["text"])) for w in words)
                    current = line_start
                    for w in words:
                        chars = max(1, self._count_chars(w["text"]))
                        w_dur = line_dur * (chars / total_chars)
                        w["start_time"] = round(current, 3)
                        w["end_time"] = round(current + w_dur, 3)
                        current += w_dur

            # Ensure end > start minimum
            if line_end <= line_start:
                line_end = line_start + 0.5
                line["end_time"] = round(line_end, 3)

            prev_end = line_end

        if overlap_count > 0:
            print(f"[Monotonic] Fixed {overlap_count} overlapping line boundaries")
        else:
            print("[Monotonic] No overlaps detected — lines are clean")

        return lyrics_lines

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
        # Stage 2: SOFA Full-Song Forced Alignment
        # ==============================================================
        print("=" * 60)
        print("[Stage 2: SOFA] Full-song forced alignment (vocals + lyrics)...")
        print("=" * 60)

        lyrics_lines = []
        try:
            from src.processors.sofa_aligner import SOFAAligner

            sofa = SOFAAligner(
                model_path=SOFA_MODEL_PATH or None,
                device=self.device,
            )

            all_words = sofa.align_words(audio_path, lyrics_text, language=detected_language)
            sofa.release_model()

            print(f"[SOFA] Aligned {len(all_words)} words from full audio")

            if all_words:
                lyrics_lines = self._group_words_into_lines(all_words, lyrics_text)
                print(f"[SOFA] Grouped into {len(lyrics_lines)} lines")
                for i, line in enumerate(lyrics_lines[:5]):
                    print(f"  [Line {i}] {line['start_time']:.2f}s - {line['end_time']:.2f}s: {line['text'][:40]}")
            else:
                print("[SOFA] No alignment results")

        except Exception as e:
            print(f"[SOFA] Error: {e}")
            import traceback
            traceback.print_exc()

        if not lyrics_lines:
            print("[SOFA] Falling back to proportional distribution")
            api_lines = [l.strip() for l in lyrics_text.split("\n") if l.strip()]
            if api_lines and duration > 0:
                per_line = duration / len(api_lines)
                for i, line_text in enumerate(api_lines):
                    start = i * per_line
                    end = start + per_line
                    lyrics_lines.append({
                        "text": line_text,
                        "start_time": round(start, 3),
                        "end_time": round(end, 3),
                        "words": self._build_word_timings(line_text, start, end),
                    })

        if progress_callback:
            progress_callback(60)

        # Clean lyrics
        lyrics_lines = self._clean_lyrics(lyrics_lines, detected_language)
        print(f"[Clean] {len(lyrics_lines)} lines after cleaning")

        # ==============================================================
        # Stage 3: Energy onset refinement (snap word starts to audio)
        # ==============================================================
        print("=" * 60)
        print("[Stage 3: Refine] Snapping word times to energy onsets...")
        print("=" * 60)

        lyrics_lines = self._refine_with_energy_onsets(lyrics_lines, audio_path)

        # ==============================================================
        # Stage 4: Enforce monotonic line boundaries (no overlaps)
        # ==============================================================
        print("=" * 60)
        print("[Stage 4: Monotonic] Enforcing non-overlapping line boundaries...")
        print("=" * 60)

        lyrics_lines = self._enforce_monotonic_lines(lyrics_lines)

        # ==============================================================
        # Stage 5: Energy analysis
        # ==============================================================
        print("=" * 60)
        print("[Stage 5: Energy] Analyzing vocal intensity...")
        print("=" * 60)

        lyrics_lines = self._add_energy_to_words(audio_path, lyrics_lines)

        # ==============================================================
        # Stage 6: Pitch analysis
        # ==============================================================
        print("=" * 60)
        print("[Stage 6: Pitch] Analyzing vocal melody...")
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
