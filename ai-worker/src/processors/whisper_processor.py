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
        if not api_lines:
            return []

        def _is_hangul_syllable(char: str) -> bool:
            return "\uac00" <= char <= "\ud7a3"

        def _strip_for_match(text: str) -> str:
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

        def _extract_syllables(text: str) -> List[str]:
            stripped = _strip_for_match(text)
            syllables = []
            for char in stripped:
                if _is_hangul_syllable(char):
                    syllables.append(char)
                elif char.isalnum():
                    syllables.append(char.lower())
            return syllables

        def _count_chars(text: str) -> int:
            return len(_extract_syllables(text))

        def _build_syllable_stream(segments: List[Dict]) -> List[Dict]:
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
                    syllables = _extract_syllables(text)
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

        wx_syllables = _build_syllable_stream(whisperx_segments)
        if not wx_syllables:
            return [{"start_time": 0, "end_time": 0, "text": line, "words": []}
                    for line in api_lines]

        line_ranges = []
        api_tokens = []
        line_break = "<LB>"
        for idx, line in enumerate(api_lines):
            line_syllables = _extract_syllables(line)
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
                words = line.split()
                word_timings = []
                if words:
                    word_dur = per_line / len(words)
                    for j, word in enumerate(words):
                        word_timings.append({
                            "start_time": round(start_time + j * word_dur, 3),
                            "end_time": round(start_time + (j + 1) * word_dur, 3),
                            "text": word,
                        })
                result.append({
                    "start_time": round(start_time, 3),
                    "end_time": round(end_time, 3),
                    "text": line,
                    "words": word_timings,
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
                        prev_chars = max(1, len(_extract_syllables(prev_lt["text"])))
                        curr_chars = max(1, len(_extract_syllables(lt["text"])))
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
                        curr_chars = max(1, len(_extract_syllables(lt["text"])))
                        next_chars = max(1, len(_extract_syllables(next_lt["text"])))
                        total_dur = dur + next_dur
                        total_chars = curr_chars + next_chars
                        new_curr_dur = total_dur * (curr_chars / total_chars)
                        new_curr_dur = max(new_curr_dur, 2.0)
                        new_boundary = lt["start_time"] + new_curr_dur
                        lt["end_time"] = round(new_boundary, 3)
                        next_lt["start_time"] = round(new_boundary, 3)
                        next_lt["end_time"] = round(new_boundary + (total_dur - new_curr_dur), 3)

        def _build_word_timings(line_text: str, line_start: float, line_end: float) -> List[Dict]:
            words = line_text.split()
            if not words:
                return []

            char_counts = [max(1, _count_chars(word)) for word in words]
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

        result = []
        prev_end = 0.0
        for line in line_timings:
            start_time = float(line["start_time"] or 0.0)
            end_time = float(line["end_time"] or (start_time + 0.5))

            if start_time < prev_end:
                start_time = prev_end
            if end_time < start_time:
                end_time = start_time + 0.5

            duration = end_time - start_time
            if duration < 1.0:
                end_time = start_time + 1.0
                duration = 1.0
            if duration > 15.0:
                end_time = start_time + 15.0

            word_timings = _build_word_timings(line["text"], start_time, end_time)
            result.append({
                "start_time": round(start_time, 3),
                "end_time": round(end_time, 3),
                "text": line["text"],
                "words": word_timings,
            })
            prev_end = end_time

        return result

    def _build_lines_with_mfa_only(self, audio_path: str, lyrics_text: str, language: str) -> List[Dict]:
        """Build lines from API text using MFA-only timing (when WhisperX fails)."""
        mfa_words: List[Dict] = []

        def _clean_text_for_mfa(text: str) -> str:
            clean = text.replace("\n", " ")
            clean = re.sub(r'\[.*?\]', '', clean)
            clean = re.sub(r'\(.*?\)', '', clean)
            clean = re.sub(r'[♪~]', '', clean)
            clean = re.sub(r'\s+', ' ', clean).strip()
            return clean

        if mfa_processor.is_available() and language in mfa_processor.LANGUAGE_MODELS:
            try:
                raw_lines = [line.strip() for line in lyrics_text.split("\n") if line.strip()]
                # Inline speech segment detection (Silero-VAD)
                try:
                    from silero_vad import load_silero_vad, read_audio, get_speech_timestamps
                    vad_model = load_silero_vad()
                    wav = read_audio(audio_path, sampling_rate=16000)
                    speech_ts = get_speech_timestamps(
                        wav, vad_model, sampling_rate=16000,
                        threshold=0.3, min_speech_duration_ms=100, min_silence_duration_ms=50,
                    )
                    speech_segments = [(ts['start'] / 16000.0, ts['end'] / 16000.0) for ts in speech_ts]
                    del vad_model
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception as e:
                    print(f"[MFA-only] VAD failed: {e}")
                    speech_segments = []

                if not raw_lines or not speech_segments:
                    raise RuntimeError("No lines or speech segments for chunked alignment")

                # Build chunks from speech segments
                max_chunk_dur = 40.0
                min_chunk_dur = 20.0
                gap_threshold = 1.0

                chunks = []
                current_start, current_end = speech_segments[0]
                for seg_start, seg_end in speech_segments[1:]:
                    gap = seg_start - current_end
                    proposed_dur = seg_end - current_start
                    if gap > gap_threshold or (proposed_dur > max_chunk_dur and (current_end - current_start) >= min_chunk_dur):
                        chunks.append((current_start, current_end))
                        current_start, current_end = seg_start, seg_end
                    else:
                        current_end = seg_end
                chunks.append((current_start, current_end))

                # Merge very short chunks to stabilize alignment
                merged_chunks = []
                for start, end in chunks:
                    if merged_chunks and (end - start) < 5.0:
                        prev_start, prev_end = merged_chunks[-1]
                        merged_chunks[-1] = (prev_start, end)
                    else:
                        merged_chunks.append((start, end))
                chunks = merged_chunks

                if len(chunks) > len(raw_lines):
                    merged_chunks = []
                    for start, end in chunks:
                        if len(merged_chunks) < len(raw_lines) - 1:
                            merged_chunks.append((start, end))
                        else:
                            prev_start, prev_end = merged_chunks[-1]
                            merged_chunks[-1] = (prev_start, end)
                    chunks = merged_chunks

                # Load audio once for slicing
                y, sr = librosa.load(audio_path, sr=16000, mono=True)
                audio_duration = len(y) / sr if sr else 0.0

                line_lengths = [max(1, len(re.sub(r'\s+', '', line))) for line in raw_lines]
                total_units = sum(line_lengths)
                chunk_durations = [max(0.1, end - start) for start, end in chunks]
                total_chunk_units = sum(chunk_durations)

                # Assign lines to chunks proportionally by duration
                assignments = []
                line_index = 0
                remaining_lines = len(raw_lines)
                remaining_units = total_units
                remaining_chunk_units = total_chunk_units
                for idx, (start, end) in enumerate(chunks):
                    if idx == len(chunks) - 1:
                        count = remaining_lines
                    else:
                        target_units = remaining_units * (chunk_durations[idx] / remaining_chunk_units) if remaining_chunk_units > 0 else remaining_units
                        acc_units = 0
                        count = 0
                        while line_index + count < len(raw_lines) and acc_units < target_units and (remaining_lines - count) > (len(chunks) - idx - 1):
                            acc_units += line_lengths[line_index + count]
                            count += 1
                        if count == 0:
                            count = 1

                    assignments.append((start, end, line_index, line_index + count))
                    used_units = sum(line_lengths[line_index:line_index + count])
                    line_index += count
                    remaining_lines -= count
                    remaining_units -= used_units
                    remaining_chunk_units -= chunk_durations[idx]

                for start, end, start_line, end_line in assignments:
                    chunk_lines = raw_lines[start_line:end_line]
                    if not chunk_lines:
                        continue
                    chunk_text = _clean_text_for_mfa(" ".join(chunk_lines))
                    if not chunk_text:
                        continue

                    chunk_start = max(0.0, start - 0.1)
                    chunk_end = end + 0.1
                    if audio_duration > 0:
                        chunk_end = min(audio_duration, chunk_end)

                    start_sample = int(chunk_start * sr)
                    end_sample = int(chunk_end * sr)
                    if end_sample <= start_sample:
                        continue

                    chunk_audio = y[start_sample:end_sample]
                    temp_path = os.path.join(TEMP_DIR, f"mfa_chunk_{uuid.uuid4().hex}.wav")
                    sf.write(temp_path, chunk_audio, sr)

                    try:
                        chunk_words = mfa_processor.align_lyrics(temp_path, chunk_text, language)
                    finally:
                        try:
                            os.remove(temp_path)
                        except OSError:
                            pass

                    if not chunk_words:
                        raise RuntimeError("Chunked MFA alignment returned no words")

                    for word in chunk_words:
                        mfa_words.append({
                            "start_time": round(word["start_time"] + chunk_start, 3),
                            "end_time": round(word["end_time"] + chunk_start, 3),
                            "text": word["text"],
                        })

                mfa_words.sort(key=lambda w: w["start_time"])
                print(f"[MFA-only] Chunked alignment produced {len(mfa_words)} words across {len(chunks)} chunks")
            except Exception as e:
                print(f"[MFA-only] Chunked alignment failed: {e} — falling back to single pass")
                mfa_words = []

        if not mfa_words and mfa_processor.is_available() and language in mfa_processor.LANGUAGE_MODELS:
            try:
                clean_text = _clean_text_for_mfa(lyrics_text)
                mfa_words = mfa_processor.align_lyrics(audio_path, clean_text, language)
                print(f"[MFA-only] Aligned {len(mfa_words)} words (single pass)")
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
        # Stage 5: MFA Refinement — DISABLED
        # ==============================================================
        # Stage 5: MFA Refinement — DISABLED
        # Single-pass MFA drifts on audio >60s and corrupts WhisperX timing
        print("[Stage 5: MFA] Skipped — WhisperX timing is sufficient (single-pass MFA causes drift)")

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
