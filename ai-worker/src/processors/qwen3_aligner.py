# type: ignore
import os
import tempfile
import unicodedata
from typing import Any

import torch


class Qwen3Aligner:
    """Wrapper for Qwen3-ForcedAligner-0.6B with WhisperX-compatible output."""

    SUPPORTED_LANGUAGES: dict[str, str] = {
        "ko": "Korean",
        "en": "English",
        "ja": "Japanese",
        "zh": "Chinese",
        "fr": "French",
        "de": "German",
        "es": "Spanish",
        "pt": "Portuguese",
        "nl": "Dutch",
        "it": "Italian",
        "pl": "Polish",
    }

    MAX_AUDIO_DURATION: int = 300  # 5 minutes in seconds

    def __init__(self, model_name: str = "Qwen/Qwen3-ForcedAligner-0.6B", device: str = "cuda:0"):
        self.model_name: str = model_name
        self.device: str = device
        self._model: Any = None  # Lazy load

    # ------------------------------------------------------------------
    # Model management
    # ------------------------------------------------------------------

    def _get_model(self) -> Any:
        """Lazy-load Qwen3-ForcedAligner model."""
        if self._model is None:
            from qwen_asr import Qwen3ForcedAligner

            print(f"[Qwen3] Loading {self.model_name}...")
            self._model = Qwen3ForcedAligner.from_pretrained(
                self.model_name,
                dtype=torch.bfloat16,
                device_map=self.device,
            )
            print("[Qwen3] Model loaded")
        return self._model

    def release_model(self) -> None:
        """Free model to reclaim GPU memory."""
        if self._model is not None:
            del self._model
            self._model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    # ------------------------------------------------------------------
    # Text helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_for_match(text: str) -> str:
        """Normalize NFKC and strip whitespace + punctuation/symbols for comparison."""
        normalized = unicodedata.normalize("NFKC", text or "")
        stripped: list[str] = []
        for char in normalized:
            if char.isspace():
                continue
            category = unicodedata.category(char)
            if category.startswith("P") or category.startswith("S"):
                continue
            stripped.append(char)
        return "".join(stripped)

    # ------------------------------------------------------------------
    # Korean morpheme → word grouping
    # ------------------------------------------------------------------

    def _group_morphemes_to_words(self, morpheme_items: list[Any], original_text: str) -> list[dict[str, Any]]:
        """
        Group Qwen3 morpheme-level results back into space-separated words.

        Strategy: Walk through original words and consume morphemes greedily.
        For each original word, consume morphemes whose concatenated text
        covers the character length of that word.
        """
        words = original_text.split()
        result: list[dict[str, Any]] = []
        morph_idx = 0

        for word in words:
            word_clean = self._strip_for_match(word)
            accumulated = ""
            group_start: float | None = None
            group_end: float | None = None

            while morph_idx < len(morpheme_items) and len(accumulated) < len(word_clean):
                item = morpheme_items[morph_idx]
                morph_text = self._strip_for_match(item.text)

                if group_start is None:
                    group_start = float(item.start_time)
                group_end = float(item.end_time)
                accumulated += morph_text
                morph_idx += 1

            result.append({
                "start_time": round(group_start if group_start is not None else 0.0, 3),
                "end_time": round(group_end if group_end is not None else 0.0, 3),
                "text": word,
            })

        return result

    # ------------------------------------------------------------------
    # Single-shot alignment
    # ------------------------------------------------------------------

    def _align_single(self, audio_path: str, text: str, language: str) -> list[dict[str, Any]]:
        """Align text to a single audio file (must be <= MAX_AUDIO_DURATION)."""
        model = self._get_model()

        results = model.align(
            audio=audio_path,
            text=text,
            language=language,
        )

        # results is List[ForcedAlignResult]; we want results[0]
        if not results or len(results[0]) == 0:
            raise RuntimeError(
                f"[Qwen3] Alignment returned empty results for: {audio_path}"
            )

        align_result = results[0]
        morpheme_items: list[Any] = list(align_result)

        # Korean always needs morpheme->word grouping (soynlp LTokenizer)
        if language.lower() == "korean":
            return self._group_morphemes_to_words(morpheme_items, text)

        # For other languages, check if token count matches word count.
        # Chinese/Japanese may produce character-level tokens that need grouping.
        words = text.split()
        if len(morpheme_items) != len(words):
            return self._group_morphemes_to_words(morpheme_items, text)

        # Direct 1:1 mapping
        return [
            {
                "start_time": round(float(item.start_time), 3),
                "end_time": round(float(item.end_time), 3),
                "text": word,
            }
            for item, word in zip(morpheme_items, words)
        ]

    # ------------------------------------------------------------------
    # Audio chunking for long audio
    # ------------------------------------------------------------------

    def _align_with_chunking(self, audio_path: str, text: str, language: str) -> list[dict[str, Any]]:
        """Handle audio >5 min by splitting into chunks with overlap."""
        import soundfile as sf

        info = sf.info(audio_path)
        duration: float = float(info.duration)

        if duration <= self.MAX_AUDIO_DURATION:
            return self._align_single(audio_path, text, language)

        print(f"[Qwen3] Audio duration {duration:.1f}s exceeds {self.MAX_AUDIO_DURATION}s, chunking...")

        chunk_duration = self.MAX_AUDIO_DURATION  # 5 min per chunk
        overlap = 30  # 30s overlap between chunks
        sr: int = int(info.samplerate)

        # Read full audio
        audio_data, _ = sf.read(audio_path, dtype="float32")

        # Calculate chunk boundaries
        chunks: list[tuple[float, float]] = []
        pos = 0.0
        while pos < duration:
            chunk_end = min(pos + chunk_duration, duration)
            chunks.append((pos, chunk_end))
            pos += chunk_duration - overlap
            if chunk_end >= duration:
                break

        # Split text into lines and distribute across chunks proportionally
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        if not lines:
            lines = [text]

        total_chars = max(sum(len(l) for l in lines), 1)

        # Assign each line to the chunk whose time range covers its proportional position
        chunk_lines: list[list[str]] = [[] for _ in chunks]
        char_pos = 0
        for line in lines:
            line_mid_frac = (char_pos + len(line) / 2) / total_chars
            time_pos = line_mid_frac * duration

            best_chunk = 0
            for ci, (cs, ce) in enumerate(chunks):
                if cs <= time_pos <= ce:
                    best_chunk = ci
                    break
            chunk_lines[best_chunk].append(line)
            char_pos += len(line)

        all_words: list[dict[str, Any]] = []

        for ci, (chunk_start, chunk_end) in enumerate(chunks):
            chunk_text = " ".join(chunk_lines[ci])
            if not chunk_text.strip():
                continue

            # Extract audio chunk and write to temp file
            start_sample = int(chunk_start * sr)
            end_sample = min(int(chunk_end * sr), len(audio_data))
            chunk_audio = audio_data[start_sample:end_sample]

            tmp_path: str | None = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    tmp_path = tmp.name
                sf.write(tmp_path, chunk_audio, sr)

                print(f"[Qwen3] Chunk {ci + 1}/{len(chunks)}: {chunk_start:.1f}s-{chunk_end:.1f}s, {len(chunk_lines[ci])} lines")

                chunk_words = self._align_single(tmp_path, chunk_text, language)

                # Offset timestamps by chunk start time
                for w in chunk_words:
                    w["start_time"] = round(float(w["start_time"]) + chunk_start, 3)
                    w["end_time"] = round(float(w["end_time"]) + chunk_start, 3)

                all_words.extend(chunk_words)

            except Exception as e:
                print(f"[Qwen3] Chunk {ci + 1} alignment failed: {e}")
                # Fallback: proportional distribution for this chunk's text
                fallback_words = self._distribute_proportional(
                    chunk_text, chunk_start, chunk_end
                )
                all_words.extend(fallback_words)

            finally:
                if tmp_path is not None:
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

        if not all_words:
            raise RuntimeError("[Qwen3] All chunks failed to align")

        return all_words

    # ------------------------------------------------------------------
    # Fallback: proportional distribution
    # ------------------------------------------------------------------

    @staticmethod
    def _distribute_proportional(text: str, start_time: float, end_time: float) -> list[dict[str, Any]]:
        """Distribute words evenly across a time range by character count."""
        words = text.split()
        if not words:
            return []

        duration = max(end_time - start_time, 0.5)
        char_counts = [max(1, len(w)) for w in words]
        total_chars = sum(char_counts)

        result: list[dict[str, Any]] = []
        current = start_time
        for word, chars in zip(words, char_counts):
            word_dur = duration * (chars / total_chars)
            result.append({
                "start_time": round(current, 3),
                "end_time": round(current + word_dur, 3),
                "text": word,
            })
            current += word_dur
        return result

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def align_words(self, audio_path: str, text: str, language: str = "Korean") -> list[dict[str, Any]]:
        """
        Align text to audio and return word-level timestamps.

        Args:
            audio_path: Path to vocal audio file (WAV/FLAC).
            text: Full lyrics text (space-separated words).
            language: Qwen3 language name (e.g., "Korean", "English").

        Returns:
            List of dicts: [{"start_time": float, "end_time": float, "text": str}, ...]
            where "text" is a SPACE-SEPARATED WORD (not a morpheme).

        Raises:
            FileNotFoundError: If audio_path does not exist.
            ValueError: If language is not supported or text is empty.
            RuntimeError: If alignment returns empty results.
        """
        if not os.path.isfile(audio_path):
            raise FileNotFoundError(f"[Qwen3] Audio file not found: {audio_path}")

        # Validate language
        lang_lower = language.lower()
        valid_names = {v.lower() for v in self.SUPPORTED_LANGUAGES.values()}
        if lang_lower not in valid_names:
            supported = ", ".join(sorted(self.SUPPORTED_LANGUAGES.values()))
            raise ValueError(
                f"[Qwen3] Unsupported language '{language}'. Supported: {supported}"
            )

        text = text.strip()
        if not text:
            raise ValueError("[Qwen3] Empty text provided for alignment")

        print(f"[Qwen3] Aligning: {os.path.basename(audio_path)}, language={language}, text_len={len(text)}")

        return self._align_with_chunking(audio_path, text, language)
