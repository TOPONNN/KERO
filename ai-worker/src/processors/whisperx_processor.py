import os
import json
import re
import gc
import uuid
import torch
import unicodedata

# WhisperX uses Silero VAD (not Pyannote) to avoid torch.load compatibility issues

import numpy as np
import librosa
from torchfcpe import spawn_bundled_infer_model
import requests
import soundfile as sf

from typing import List, Dict, Callable, Optional
from src.config import TEMP_DIR, LYRICS_API_URL, USE_SOFA_ALIGNER, SOFA_MODEL_PATH
from src.services.s3_service import s3_service


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
                "large-v3", self.device, compute_type=compute,
                vad_method="silero"
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


    def _whisperx_transcribe(self, audio_path: str, language: Optional[str] = None) -> Optional[List[Dict]]:
        """Transcribe audio with WhisperX for rough segment timing only."""
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

            self._release_whisperx_model()
            return result.get("segments", [])
        except Exception as e:
            print(f"[WhisperX] Transcription failed: {e}")
            self._release_whisperx_model()
            return None

    def _whisperx_align_segments(self, audio_path: str, segments: List[Dict], language: Optional[str]) -> Optional[Dict]:
        """Align provided text segments to audio using wav2vec2 forced alignment."""
        if not segments:
            return None

        try:
            import whisperx

            audio = whisperx.load_audio(audio_path)
            model_a, metadata = whisperx.load_align_model(
                language_code=language or "en", device=self.device
            )
            align_segments = []
            for seg in segments:
                text = seg.get("text", "")
                start = seg.get("start", seg.get("start_time", 0.0))
                end = seg.get("end", seg.get("end_time", start))
                align_segments.append({
                    "text": text,
                    "start": float(start),
                    "end": float(end),
                })
            result = whisperx.align(
                align_segments, model_a, metadata,
                audio, self.device, return_char_alignments=True
            )
            print(f"[WhisperX] Aligned {len(result.get('segments', []))} segments")
            del model_a
            torch.cuda.empty_cache()
            return result
        except Exception as e:
            print(f"[WhisperX] Alignment failed: {e}")
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            return None

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

    def _build_syllable_stream(self, segments: List[Dict]) -> List[Dict]:
        stream = []
        for seg in segments or []:
            words = seg.get("words", []) or []
            if not words and seg.get("text", "").strip():
                words = [{
                    "start": seg.get("start", 0.0),
                    "end": seg.get("end", seg.get("start", 0.0)),
                    "word": seg.get("text", ""),
                }]

            for word in words:
                start = word.get("start", word.get("start_time", 0.0))
                end = word.get("end", word.get("end_time", start))
                text = word.get("word", word.get("text", "")).strip()
                syllables = self._extract_syllables(text)
                if not syllables:
                    continue
                duration = max(end - start, 0.001)
                step = duration / len(syllables)
                for idx, syl in enumerate(syllables):
                    stream.append({
                        "syl": syl,
                        "start_time": start + idx * step,
                        "end_time": start + (idx + 1) * step,
                    })
        stream.sort(key=lambda item: item["start_time"])
        return stream

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

    def _interpolate_unmatched_words(self, word_timings: List[Dict], line_start: float, line_end: float) -> None:
        if not word_timings:
            return

        matched_indices = [
            idx for idx, word in enumerate(word_timings)
            if word.get("start_time") is not None and word.get("end_time") is not None
        ]
        if not matched_indices:
            char_counts = [max(1, self._count_chars(w["text"])) for w in word_timings]
            total_chars = sum(char_counts)
            duration = max(line_end - line_start, 0.5)
            current = line_start
            for idx, word in enumerate(word_timings):
                word_dur = duration * (char_counts[idx] / total_chars)
                word["start_time"] = current
                word["end_time"] = current + word_dur
                current += word_dur
            return

        first_idx = matched_indices[0]
        if first_idx > 0:
            start = line_start
            end = word_timings[first_idx]["start_time"]
            gap = first_idx
            char_counts = [
                max(1, self._count_chars(word_timings[offset]["text"]))
                for offset in range(gap)
            ]
            total_chars = sum(char_counts)
            gap_duration = end - start
            current = start
            for offset in range(gap):
                word = word_timings[offset]
                word_dur = gap_duration * (char_counts[offset] / total_chars) if total_chars > 0 else 0.0
                word["start_time"] = current
                word["end_time"] = current + word_dur
                current += word_dur

        for left_idx, right_idx in zip(matched_indices, matched_indices[1:]):
            gap = right_idx - left_idx - 1
            if gap <= 0:
                continue
            start = word_timings[left_idx]["end_time"]
            end = word_timings[right_idx]["start_time"]
            char_counts = [
                max(1, self._count_chars(word_timings[left_idx + 1 + k]["text"]))
                for k in range(gap)
            ]
            total_chars = sum(char_counts)
            gap_duration = end - start
            current = start
            for offset in range(gap):
                word = word_timings[left_idx + 1 + offset]
                word_dur = gap_duration * (char_counts[offset] / total_chars) if total_chars > 0 else gap_duration / gap
                word["start_time"] = current
                word["end_time"] = current + word_dur
                current += word_dur

        last_idx = matched_indices[-1]
        if last_idx < len(word_timings) - 1:
            start = word_timings[last_idx]["end_time"]
            end = line_end
            gap = len(word_timings) - 1 - last_idx
            char_counts = [
                max(1, self._count_chars(word_timings[last_idx + 1 + offset]["text"]))
                for offset in range(gap)
            ]
            total_chars = sum(char_counts)
            gap_duration = end - start
            current = start
            for offset in range(gap):
                word = word_timings[last_idx + 1 + offset]
                word_dur = gap_duration * (char_counts[offset] / total_chars) if total_chars > 0 else 0.0
                word["start_time"] = current
                word["end_time"] = current + word_dur
                current += word_dur

    def _enforce_monotonic(self, word_timings: List[Dict], min_word_dur: float, base_start: float) -> None:
        prev_end = base_start
        for word in word_timings:
            start = float(word.get("start_time") or prev_end)
            end = float(word.get("end_time") or start)
            if start < prev_end:
                start = prev_end
            if end < start + min_word_dur:
                end = start + min_word_dur
            word["start_time"] = start
            word["end_time"] = end
            prev_end = end

    def _check_line_alignment_quality(self, word_timings: List[Dict], line_start: float, line_end: float) -> bool:
        """Check if word-level alignment within a line is reasonable.
        Returns True if quality is acceptable, False if redistribution needed."""
        if not word_timings or len(word_timings) <= 1:
            return True

        line_duration = max(line_end - line_start, 0.5)
        total_syllables = sum(max(1, self._count_chars(w["text"])) for w in word_timings)

        for word in word_timings:
            duration = word["end_time"] - word["start_time"]
            syllables = max(1, self._count_chars(word["text"]))
            expected = line_duration * (syllables / total_syllables)

            if expected > 0.01:
                ratio = duration / expected
                # Word takes 3x more or 5x less time than expected by syllable count
                if ratio > 3.0 or ratio < 0.2:
                    return False

        # Also check: any word with less than 80ms per syllable
        for word in word_timings:
            duration = word["end_time"] - word["start_time"]
            syllables = max(1, self._count_chars(word["text"]))
            if duration < syllables * 0.08:
                return False

        return True

    def _redistribute_words_proportional(self, word_timings: List[Dict], line_start: float, line_end: float) -> None:
        """Redistribute ALL words in a line proportionally by syllable count."""
        if not word_timings:
            return

        total_syllables = sum(max(1, self._count_chars(w["text"])) for w in word_timings)
        duration = max(line_end - line_start, 0.5)

        current_time = line_start
        for word in word_timings:
            syllables = max(1, self._count_chars(word["text"]))
            word_duration = duration * (syllables / total_syllables)
            word["start_time"] = round(current_time, 3)
            word["end_time"] = round(current_time + word_duration, 3)
            current_time += word_duration

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

    def _map_lines_to_audio(self, lyrics_text: str, whisperx_segments: List[Dict]) -> List[Dict]:
        """Map API lyric lines to audio timing using DP syllable alignment."""
        api_lines = [l.strip() for l in lyrics_text.split("\n") if l.strip()]
        if not api_lines:
            return []

        wx_syllables = self._build_syllable_stream(whisperx_segments)
        if not wx_syllables:
            return [{"start": 0.0, "end": 0.0, "text": line} for line in api_lines]

        line_ranges = []
        api_tokens = []
        line_break = "<LB>"
        for idx, line in enumerate(api_lines):
            line_syllables = self._extract_syllables(line)
            start_idx = len(api_tokens)
            api_tokens.extend(line_syllables)
            end_idx = len(api_tokens)
            line_ranges.append((start_idx, end_idx))
            if idx < len(api_lines) - 1:
                api_tokens.append(line_break)

        if not api_tokens:
            total_start = wx_syllables[0]["start_time"]
            total_end = wx_syllables[-1]["end_time"]
            total_duration = max(total_end - total_start, 0.5)
            per_line = total_duration / len(api_lines)
            result = []
            for i, line in enumerate(api_lines):
                start_time = total_start + i * per_line
                end_time = start_time + per_line
                result.append({
                    "start": round(start_time, 3),
                    "end": round(end_time, 3),
                    "text": line,
                })
            return result

        match_score = 2.0
        mismatch_penalty = -1.0
        gap_penalty = -0.5
        neg_inf = -1e9

        n = len(api_tokens)
        m = len(wx_syllables)
        score = [[0.0] * (m + 1) for _ in range(n + 1)]
        trace = [[0] * (m + 1) for _ in range(n + 1)]

        for i in range(1, n + 1):
            gap = 0.0 if api_tokens[i - 1] == line_break else gap_penalty
            score[i][0] = score[i - 1][0] + gap
            trace[i][0] = 1

        for j in range(1, m + 1):
            score[0][j] = score[0][j - 1] + gap_penalty
            trace[0][j] = 2

        for i in range(1, n + 1):
            api_token = api_tokens[i - 1]
            for j in range(1, m + 1):
                if api_token == line_break:
                    diag = neg_inf
                    up = score[i - 1][j]
                    left = score[i][j - 1] + gap_penalty
                else:
                    wx_token = wx_syllables[j - 1]["syl"]
                    match = match_score if api_token == wx_token else mismatch_penalty
                    diag = score[i - 1][j - 1] + match
                    up = score[i - 1][j] + gap_penalty
                    left = score[i][j - 1] + gap_penalty

                best = diag
                direction = 0
                if up > best:
                    best = up
                    direction = 1
                if left > best:
                    best = left
                    direction = 2
                score[i][j] = best
                trace[i][j] = direction

        aligned_indices = [-1] * n
        i = n
        j = m
        while i > 0 or j > 0:
            if i > 0 and j > 0 and trace[i][j] == 0:
                if api_tokens[i - 1] != line_break:
                    aligned_indices[i - 1] = j - 1
                i -= 1
                j -= 1
            elif i > 0 and (trace[i][j] == 1 or j == 0):
                i -= 1
            else:
                j -= 1

        line_timings = []
        for line_idx, (start_idx, end_idx) in enumerate(line_ranges):
            aligned = [aligned_indices[k] for k in range(start_idx, end_idx)
                       if aligned_indices[k] >= 0]
            if aligned:
                min_idx = min(aligned)
                max_idx = max(aligned)
                start_time = wx_syllables[min_idx]["start_time"]
                end_time = wx_syllables[max_idx]["end_time"]
            else:
                start_time = None
                end_time = None
            line_timings.append({
                "start_time": start_time,
                "end_time": end_time,
                "text": api_lines[line_idx],
            })

        next_with_time: List[int] = [-1] * len(line_timings)
        next_idx = -1
        for idx in range(len(line_timings) - 1, -1, -1):
            if line_timings[idx]["start_time"] is not None:
                next_idx = idx
            next_with_time[idx] = next_idx

        prev_idx: Optional[int] = None
        for idx, line in enumerate(line_timings):
            if line["start_time"] is not None:
                prev_idx = idx
                continue

            next_idx = next_with_time[idx]
            prev_line = line_timings[prev_idx] if prev_idx is not None else None
            next_line = line_timings[next_idx] if next_idx >= 0 else None

            if prev_line is not None and next_line is not None and prev_idx is not None:
                gap = next_idx - prev_idx
                ratio = (idx - prev_idx) / gap if gap else 1.0
                line["start_time"] = prev_line["start_time"] + (next_line["start_time"] - prev_line["start_time"]) * ratio
                line["end_time"] = prev_line["end_time"] + (next_line["end_time"] - prev_line["end_time"]) * ratio
            elif next_line is not None and prev_line is None:
                gap = next_idx + 1
                ratio = (idx + 1) / gap if gap else 1.0
                line["start_time"] = next_line["start_time"] * ratio
                line["end_time"] = next_line["end_time"] * ratio
            elif prev_line is not None and next_line is None and prev_idx is not None:
                offset = idx - prev_idx
                line["start_time"] = prev_line["end_time"] + 0.5 * offset
                line["end_time"] = line["start_time"] + 0.5
            else:
                line["start_time"] = 0.0
                line["end_time"] = 0.5

        for idx in range(len(line_timings)):
            lt = line_timings[idx]
            if lt["start_time"] is None or lt["end_time"] is None:
                continue
            dur = lt["end_time"] - lt["start_time"]
            if dur < 1.5 and idx > 0:
                prev_lt = line_timings[idx - 1]
                if prev_lt["start_time"] is not None and prev_lt["end_time"] is not None:
                    prev_dur = prev_lt["end_time"] - prev_lt["start_time"]
                    if prev_dur > 6.0:
                        prev_chars = max(1, len(self._extract_syllables(prev_lt["text"])))
                        curr_chars = max(1, len(self._extract_syllables(lt["text"])))
                        total_dur = prev_dur + dur
                        total_chars = prev_chars + curr_chars
                        new_prev_dur = total_dur * (prev_chars / total_chars)
                        new_prev_dur = max(new_prev_dur, 2.0)
                        new_boundary = prev_lt["start_time"] + new_prev_dur
                        prev_lt["end_time"] = round(new_boundary, 3)
                        lt["start_time"] = round(new_boundary, 3)
                        lt["end_time"] = round(new_boundary + (total_dur - new_prev_dur), 3)

            if dur > 6.0 and idx < len(line_timings) - 1:
                next_lt = line_timings[idx + 1]
                if next_lt["start_time"] is not None and next_lt["end_time"] is not None:
                    next_dur = next_lt["end_time"] - next_lt["start_time"]
                    if next_dur < 1.5:
                        curr_chars = max(1, len(self._extract_syllables(lt["text"])))
                        next_chars = max(1, len(self._extract_syllables(next_lt["text"])))
                        total_dur = dur + next_dur
                        total_chars = curr_chars + next_chars
                        new_curr_dur = total_dur * (curr_chars / total_chars)
                        new_curr_dur = max(new_curr_dur, 2.0)
                        new_boundary = lt["start_time"] + new_curr_dur
                        lt["end_time"] = round(new_boundary, 3)
                        next_lt["start_time"] = round(new_boundary, 3)
                        next_lt["end_time"] = round(new_boundary + (total_dur - new_curr_dur), 3)

        result = []
        for line in line_timings:
            start_time = line["start_time"]
            end_time = line["end_time"]
            if start_time is None or end_time is None:
                start_time = 0.0 if start_time is None else start_time
                end_time = start_time + 0.5 if end_time is None else end_time
            result.append({
                "start": round(float(start_time), 3),
                "end": round(float(end_time), 3),
                "text": line["text"],
            })
        return result

    def _build_lyrics_from_aligned(self, api_segments: List[Dict], aligned_result: Optional[Dict]) -> List[Dict]:
        """Convert whisperx aligned output to our lyrics format."""
        aligned_segments: List[Dict] = []
        if isinstance(aligned_result, dict):
            aligned_segments = aligned_result.get("segments", []) or []
        elif isinstance(aligned_result, list):
            aligned_segments = aligned_result

        result = []
        prev_end = 0.0
        min_word_dur = 0.06

        for idx, api_seg in enumerate(api_segments):
            aligned_seg = aligned_segments[idx] if idx < len(aligned_segments) else {}
            words_data = aligned_seg.get("words") or []

            word_timings: List[Dict] = []
            for word in words_data:
                w_start = word.get("start", word.get("start_time"))
                w_end = word.get("end", word.get("end_time"))
                w_text = word.get("word", word.get("text", "")).strip()
                if not w_text:
                    continue
                word_timings.append({
                    "start_time": None if w_start is None else float(w_start),
                    "end_time": None if w_end is None else float(w_end),
                    "text": w_text,
                })

            line_start = float(api_seg.get("start", prev_end))
            line_end = float(api_seg.get("end", line_start + 1.0))

            if line_start < prev_end:
                line_start = prev_end
            if line_end < line_start:
                line_end = line_start + 0.5

            duration = line_end - line_start
            if duration < 1.0:
                line_end = line_start + 1.0
            if duration > 15.0:
                line_end = line_start + 15.0

            if word_timings:
                # Step A: Detect badly-aligned words (too short for their syllable count)
                # and nullify them so they get redistributed
                for wt in word_timings:
                    if wt["start_time"] is not None and wt["end_time"] is not None:
                        dur = wt["end_time"] - wt["start_time"]
                        syllables = max(1, self._count_chars(wt["text"]))
                        min_expected = syllables * 0.08  # 80ms per syllable
                        if dur < min_expected:
                            wt["start_time"] = None
                            wt["end_time"] = None

                # Step B: Interpolate unmatched words (proportional)
                self._interpolate_unmatched_words(word_timings, line_start, line_end)
                self._enforce_monotonic(word_timings, min_word_dur, line_start)

                # Step C: Check overall line alignment quality
                if not self._check_line_alignment_quality(word_timings, line_start, line_end):
                    # Full proportional redistribution for poorly-aligned lines
                    self._redistribute_words_proportional(word_timings, line_start, line_end)

                for word in word_timings:
                    word["start_time"] = round(float(word["start_time"]), 3)
                    word["end_time"] = round(float(word["end_time"]), 3)
            else:
                word_timings = self._build_word_timings(api_seg["text"], line_start, line_end)

            if word_timings:
                line_start_final = word_timings[0]["start_time"]
                line_end_final = word_timings[-1]["end_time"]
            else:
                line_start_final = round(float(line_start), 3)
                line_end_final = round(float(line_end), 3)

            result.append({
                "start_time": round(float(line_start_final), 3),
                "end_time": round(float(line_end_final), 3),
                "text": api_seg["text"],
                "words": word_timings,
            })
            prev_end = float(line_end_final)

        return result


    def _build_lyrics_from_sofa(self, api_segments: List[Dict], sofa_words: List[Dict]) -> List[Dict]:
        """Map SOFA flat word list back to original line structure from api_segments."""
        if not sofa_words or not api_segments:
            return []

        lyrics_lines = []
        word_idx = 0

        for seg in api_segments:
            line_text = seg.get("text", "").strip()
            if not line_text:
                continue

            expected_words = line_text.split()
            line_words = []

            for expected_word in expected_words:
                if word_idx < len(sofa_words):
                    w = sofa_words[word_idx]
                    line_words.append({
                        "text": expected_word,
                        "start_time": round(w["start_time"], 3),
                        "end_time": round(w["end_time"], 3),
                    })
                    word_idx += 1
                else:
                    if line_words:
                        last_end = line_words[-1]["end_time"]
                    elif lyrics_lines and lyrics_lines[-1]["words"]:
                        last_end = lyrics_lines[-1]["words"][-1]["end_time"]
                    else:
                        last_end = 0.0
                    line_words.append({
                        "text": expected_word,
                        "start_time": round(last_end, 3),
                        "end_time": round(last_end + 0.5, 3),
                    })

            if line_words:
                lyrics_lines.append({
                    "text": line_text,
                    "start_time": line_words[0]["start_time"],
                    "end_time": line_words[-1]["end_time"],
                    "words": line_words,
                })

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
        # Stage 2: WhisperX Transcription (rough timing only)
        # ==============================================================
        print("=" * 60)
        print("[Stage 2: WhisperX] Transcribing for rough timing...")
        print("=" * 60)

        whisperx_segments = self._whisperx_transcribe(audio_path, detected_language)

        if progress_callback:
            progress_callback(50)

        # ==============================================================
        # Stage 3: Map API lyrics lines to audio regions (DP)
        # ==============================================================
        print("=" * 60)
        print("[Stage 3: Mapping] Mapping API lines onto audio timing...")
        print("=" * 60)

        def _build_even_line_segments(text: str, total_duration: float) -> List[Dict]:
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            if not lines:
                return []
            if total_duration <= 0:
                total_duration = max(len(lines) * 0.5, 1.0)
            per_line = total_duration / len(lines)
            segments = []
            for i, line in enumerate(lines):
                start = i * per_line
                end = start + per_line
                segments.append({
                    "start": round(float(start), 3),
                    "end": round(float(end), 3),
                    "text": line,
                })
            return segments

        if whisperx_segments:
            api_line_segments = self._map_lines_to_audio(lyrics_text, whisperx_segments)
            print(f"[Mapping] {len(api_line_segments)} lines mapped to audio regions")
        else:
            print("[Mapping] WhisperX failed — using even line distribution")
            api_line_segments = _build_even_line_segments(lyrics_text, duration)

        if progress_callback:
            progress_callback(55)

        # ==============================================================
        # Stage 4: Forced Alignment (SOFA or WhisperX)
        # ==============================================================
        print("=" * 60)
        if USE_SOFA_ALIGNER:
            print("[Stage 4: SOFA] Singing-oriented forced alignment...")
        else:
            print("[Stage 4: WhisperX] Forced alignment (wav2vec2)...")
        print("=" * 60)

        lyrics_lines = []
        if api_line_segments:
            if USE_SOFA_ALIGNER:
                try:
                    from src.processors.sofa_aligner import SOFAAligner

                    full_text = "\n".join(seg["text"] for seg in api_line_segments)

                    sofa = SOFAAligner(
                        model_path=SOFA_MODEL_PATH or None,
                        device=self.device,
                    )
                    sofa_words = sofa.align_words(audio_path, full_text, language=detected_language)
                    sofa.release_model()

                    if sofa_words:
                        lyrics_lines = self._build_lyrics_from_sofa(api_line_segments, sofa_words)
                        print(f"[SOFA] Aligned {len(sofa_words)} words across {len(lyrics_lines)} lines")
                    else:
                        print("[SOFA] No alignment results — falling back to WhisperX")
                        aligned_segments = self._whisperx_align_segments(audio_path, api_line_segments, detected_language)
                        lyrics_lines = self._build_lyrics_from_aligned(api_line_segments, aligned_segments)
                except Exception as e:
                    print(f"[SOFA] Error: {e} — falling back to WhisperX")
                    aligned_segments = self._whisperx_align_segments(audio_path, api_line_segments, detected_language)
                    lyrics_lines = self._build_lyrics_from_aligned(api_line_segments, aligned_segments)
            else:
                aligned_segments = self._whisperx_align_segments(audio_path, api_line_segments, detected_language)
                lyrics_lines = self._build_lyrics_from_aligned(api_line_segments, aligned_segments)
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
