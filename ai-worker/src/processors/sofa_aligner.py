"""SOFA (Singing-Oriented Forced Aligner) wrapper for the KERO ai-worker.

Provides word-level timestamp alignment for Korean singing voice using:
  - Korean G2P module for text → phoneme conversion
  - ONNX Runtime for model inference
  - Viterbi decoding for optimal alignment

Output format matches the existing pipeline:
  [{"start_time": float, "end_time": float, "text": str}, ...]
"""

from __future__ import annotations

import gc
import logging
import math
import yaml
from typing import TYPE_CHECKING, Dict, List, Optional, Tuple

if TYPE_CHECKING:
    import numpy as np

from pathlib import Path

logger = logging.getLogger(__name__)

# Base directory for SOFA resources (ai-worker/sofa/)
SOFA_DIR = Path(__file__).resolve().parent.parent.parent / "sofa"

# Audio parameters expected by the SOFA ONNX model
_SOFA_SAMPLE_RATE = 44100
_SOFA_HOP_LENGTH = 512

# Chunking parameters for long audio (memory management)
_CHUNK_DURATION_SEC = 300  # 5 minutes per chunk
_CHUNK_OVERLAP_SEC = 30    # 30s overlap between chunks


class SOFAAligner:
    """Singing-oriented forced aligner using SOFA ONNX model.

    Lazy-loads all heavy dependencies (numpy, soundfile, librosa, SOFA modules)
    to avoid import errors in environments without GPU dependencies.
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        device: str = "cuda",
    ) -> None:
        """Initialise the aligner.

        Args:
            model_path: Path to SOFA ONNX model file. Defaults to
                ``sofa/models/sofa_korean.onnx`` relative to the ai-worker root.
            device: ``"cuda"`` or ``"cpu"`` for ONNX Runtime provider selection.
        """
        self._model_path = model_path or str(
            SOFA_DIR / "models" / "sofa_korean.onnx"
        )
        self._device = device
        self._infer_engine = None   # Lazy-loaded SOFAOnnxInfer
        self._g2p = None            # Lazy-loaded KoreanG2P
        self._ph_to_idx: Optional[dict] = None  # Lazy-loaded phoneme vocab

    # ------------------------------------------------------------------
    # Lazy loaders
    # ------------------------------------------------------------------

    def _get_g2p(self):
        """Lazy-load Korean G2P module."""
        if self._g2p is None:
            from sofa.g2p.korean_g2p import KoreanG2P

            self._g2p = KoreanG2P()
            logger.info("Loaded Korean G2P module")
        return self._g2p

    def _get_infer_engine(self):
        """Lazy-load ONNX inference engine."""
        if self._infer_engine is None:
            from sofa.inference.onnx_infer import SOFAOnnxInfer

            self._infer_engine = SOFAOnnxInfer(
                model_path=self._model_path,
                device=self._device,
                sample_rate=_SOFA_SAMPLE_RATE,
                hop_length=_SOFA_HOP_LENGTH,
            )
            logger.info(
                "Loaded SOFA ONNX engine (model=%s, device=%s)",
                self._model_path,
                self._device,
            )
        return self._infer_engine

    def _get_ph_to_idx(self) -> dict:
        """Load phoneme vocabulary from YAML config (ground truth from training).

        First attempts to load from ``sofa/models/sofa_korean_config.yaml``,
        which contains the exact vocab the ONNX model was trained with.
        Falls back to building from ``sofa/dictionary/korean.txt`` if YAML is unavailable.

        Returns:
            Mapping ``phoneme_string → integer_index``.
        """
        if self._ph_to_idx is not None:
            return self._ph_to_idx

        # Try loading from YAML config (ground truth from training)
        config_path = SOFA_DIR / "models" / "sofa_korean_config.yaml"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = yaml.safe_load(f)
                vocab_section = config.get("vocab", {})
                ph_to_idx = {}
                for key, value in vocab_section.items():
                    # Only take forward mapping: string key → int value
                    # Skip reverse mappings (int keys) and metadata (<vocab_size>)
                    if isinstance(key, str) and isinstance(value, int) and not key.startswith("<"):
                        ph_to_idx[key] = value
                if ph_to_idx:
                    self._ph_to_idx = ph_to_idx
                    logger.info(
                        "Loaded phoneme vocabulary from config: %d phonemes from %s",
                        len(self._ph_to_idx),
                        config_path,
                    )
                    return self._ph_to_idx
            except Exception as e:
                logger.warning("Failed to load vocab from config %s: %s", config_path, e)

        # Fallback: build from dictionary file (original approach)
        dict_path = SOFA_DIR / "dictionary" / "korean.txt"
        if not dict_path.exists():
            raise FileNotFoundError(
                f"Korean phoneme dictionary not found: {dict_path}"
            )

        phonemes: set = set()
        with open(dict_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split("\t")
                if len(parts) == 2:
                    phs = parts[1].split()
                    phonemes.update(phs)

        # SP must be index 0 (silence token); sort the rest for determinism
        phonemes.discard("SP")
        sorted_phs = ["SP"] + sorted(phonemes)
        self._ph_to_idx = {ph: idx for idx, ph in enumerate(sorted_phs)}

        logger.info(
            "Loaded phoneme vocabulary (fallback): %d phonemes from %s",
            len(self._ph_to_idx),
            dict_path,
        )
        return self._ph_to_idx

    # ------------------------------------------------------------------
    # Audio helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_audio(audio_path: str) -> "np.ndarray":
        """Load audio file and resample to 44100 Hz mono float32.

        Uses soundfile for reading and librosa for resampling when needed.

        Args:
            audio_path: Path to any audio file supported by soundfile.

        Returns:
            1-D numpy float32 array at 44100 Hz.
        """
        import numpy as np
        import soundfile as sf

        if not Path(audio_path).exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        data, sr = sf.read(audio_path, dtype="float32", always_2d=True)

        # Downmix to mono
        if data.shape[1] > 1:
            waveform = np.mean(data, axis=1)
        else:
            waveform = data[:, 0]

        # Resample to SOFA sample rate if needed
        if sr != _SOFA_SAMPLE_RATE:
            import librosa

            waveform = librosa.resample(
                waveform, orig_sr=sr, target_sr=_SOFA_SAMPLE_RATE
            )

        return waveform.astype(np.float32)

    # ------------------------------------------------------------------
    # Core alignment
    # ------------------------------------------------------------------

    def _align_chunk(
        self,
        waveform: "np.ndarray",
        ph_seq: List[str],
        word_seq: List[str],
        ph_idx_to_word_idx: List[int],
    ) -> List[Dict]:
        """Run SOFA alignment on a single audio chunk.

        Args:
            waveform: Mono float32 audio at 44100 Hz.
            ph_seq: Phoneme sequence from G2P (starts/ends with SP).
            word_seq: List of words corresponding to phoneme groups.
            ph_idx_to_word_idx: Maps each phoneme index → word index (-1 for SP).

        Returns:
            List of word dicts with ``start_time``, ``end_time``, ``text``.
        """
        import numpy as np

        engine = self._get_infer_engine()
        ph_to_idx = self._get_ph_to_idx()

        # Filter phonemes not in vocabulary (safety)
        valid_ph_seq: List[str] = []
        valid_ph_word_map: List[int] = []
        for ph, widx in zip(ph_seq, ph_idx_to_word_idx):
            if ph in ph_to_idx:
                valid_ph_seq.append(ph)
                valid_ph_word_map.append(widx)
            else:
                logger.warning("Phoneme %r not in vocabulary — skipping", ph)

        if len(valid_ph_seq) < 2:
            logger.warning("Too few phonemes (%d) for alignment", len(valid_ph_seq))
            return []

        # Run ONNX inference → list of (phoneme, start_sec, end_sec)
        phoneme_timestamps: List[Tuple[str, float, float]] = engine.infer(
            waveform, valid_ph_seq, ph_to_idx
        )

        if not phoneme_timestamps:
            logger.warning("SOFA inference returned no timestamps")
            return []

        # Build a mapping from valid phoneme index → (start, end)
        # phoneme_timestamps may be shorter than valid_ph_seq due to
        # Viterbi decode merging; use ph_idx_seq alignment from infer.
        # However, the infer output already has one entry per aligned segment
        # (not necessarily 1:1 with input ph_seq). We need to match them.
        #
        # SOFAOnnxInfer.infer returns tuples aligned by ph_idx_seq from
        # Viterbi backtrack. Each tuple maps to a phoneme in the input
        # ph_seq by index (the Viterbi states correspond to input positions).
        # The returned list length equals the number of Viterbi segments,
        # which is typically == len(ph_seq).

        # Aggregate phoneme timestamps to word level
        # Group by word index from ph_idx_to_word_idx
        word_starts: Dict[int, float] = {}
        word_ends: Dict[int, float] = {}

        # Map phoneme timestamps back to word indices
        # phoneme_timestamps[i] corresponds to valid_ph_seq[i]
        # (but Viterbi may produce fewer segments if phonemes are skipped)
        num_ts = len(phoneme_timestamps)
        num_ph = len(valid_ph_seq)

        if num_ts == num_ph:
            # 1:1 correspondence — ideal case
            for i, (ph, start, end) in enumerate(phoneme_timestamps):
                widx = valid_ph_word_map[i]
                if widx < 0:
                    continue  # SP boundary
                if widx not in word_starts or start < word_starts[widx]:
                    word_starts[widx] = start
                if widx not in word_ends or end > word_ends[widx]:
                    word_ends[widx] = end
        else:
            # Fallback: match by phoneme string identity in order
            ph_cursor = 0
            for ts_ph, ts_start, ts_end in phoneme_timestamps:
                # Advance cursor to find matching phoneme
                while ph_cursor < num_ph and valid_ph_seq[ph_cursor] != ts_ph:
                    ph_cursor += 1
                if ph_cursor >= num_ph:
                    break
                widx = valid_ph_word_map[ph_cursor]
                if widx >= 0:
                    if widx not in word_starts or ts_start < word_starts[widx]:
                        word_starts[widx] = ts_start
                    if widx not in word_ends or ts_end > word_ends[widx]:
                        word_ends[widx] = ts_end
                ph_cursor += 1

        # Build word-level output in order
        words: List[Dict] = []
        for widx, word_text in enumerate(word_seq):
            if widx in word_starts and widx in word_ends:
                words.append({
                    "start_time": round(float(word_starts[widx]), 3),
                    "end_time": round(float(word_ends[widx]), 3),
                    "text": word_text,
                })
            else:
                logger.debug(
                    "Word %r (idx=%d) has no phoneme timestamps — skipping",
                    word_text,
                    widx,
                )

        return words

    # ------------------------------------------------------------------
    # Text splitting for chunks
    # ------------------------------------------------------------------

    @staticmethod
    def _split_text_for_chunks(
        text: str,
        num_chunks: int,
    ) -> List[str]:
        """Split lyrics text into roughly equal portions for audio chunks.

        Splits by lines, distributing proportionally by line count.

        Args:
            text: Full lyrics text (newline-separated lines).
            num_chunks: Number of audio chunks.

        Returns:
            List of text strings, one per chunk.
        """
        lines = [l for l in text.split("\n") if l.strip()]
        if not lines:
            return [""] * num_chunks

        # Distribute lines proportionally
        lines_per_chunk = max(1, math.ceil(len(lines) / num_chunks))
        chunks: List[str] = []
        for i in range(num_chunks):
            start = i * lines_per_chunk
            end = min(start + lines_per_chunk, len(lines))
            chunk_lines = lines[start:end]
            chunks.append("\n".join(chunk_lines))

        # Pad with empty strings if we have fewer text chunks than audio chunks
        while len(chunks) < num_chunks:
            chunks.append("")

        return chunks

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def align_words(
        self,
        audio_path: str,
        text: str,
        language: str = "ko",
    ) -> List[Dict]:
        """Align lyrics text to audio using SOFA forced alignment.

        For long audio files (>5 minutes), the audio is automatically split
        into overlapping chunks, each aligned independently, then merged.

        Args:
            audio_path: Path to audio file (WAV recommended, any sample rate).
            text: Lyrics text. Words separated by spaces, lines by newlines.
            language: Language code. Currently only ``"ko"`` is supported.

        Returns:
            List of word dicts::

                [{"start_time": float, "end_time": float, "text": str}, ...]

            Returns an empty list on failure (caller should handle fallback).
        """
        import numpy as np

        if language != "ko":
            logger.warning(
                "SOFAAligner only supports Korean (ko); got %r. "
                "Proceeding anyway — results may be poor.",
                language,
            )

        try:
            # 1. Load and resample audio
            logger.info("Loading audio: %s", audio_path)
            waveform = self._load_audio(audio_path)
            duration_sec = len(waveform) / _SOFA_SAMPLE_RATE
            logger.info(
                "Audio loaded: %.1fs, %d samples", duration_sec, len(waveform)
            )

            # 2. Decide whether to chunk
            if duration_sec <= _CHUNK_DURATION_SEC + _CHUNK_OVERLAP_SEC:
                # Short enough to process in one go
                return self._align_single(waveform, text)
            else:
                return self._align_chunked(waveform, text, duration_sec)

        except FileNotFoundError:
            logger.error("File not found during SOFA alignment", exc_info=True)
            raise
        except Exception:
            logger.error("SOFA alignment failed", exc_info=True)
            return []

    def _align_single(
        self,
        waveform: "np.ndarray",
        text: str,
    ) -> List[Dict]:
        """Align a single (non-chunked) audio waveform to text.

        Args:
            waveform: Mono float32 audio at 44100 Hz.
            text: Lyrics text.

        Returns:
            Word-level alignment list.
        """
        g2p = self._get_g2p()
        ph_seq, word_seq, ph_idx_to_word_idx = g2p._g2p(text)

        if not word_seq:
            logger.warning("G2P produced no words from text")
            return []

        logger.info(
            "G2P: %d phonemes, %d words", len(ph_seq), len(word_seq)
        )

        return self._align_chunk(waveform, ph_seq, word_seq, ph_idx_to_word_idx)

    def _align_chunked(
        self,
        waveform: "np.ndarray",
        text: str,
        duration_sec: float,
    ) -> List[Dict]:
        """Align long audio by splitting into overlapping chunks.

        Strategy:
          - Split audio into 5-minute chunks with 30s overlap.
          - Split text lines proportionally across chunks.
          - Align each chunk independently.
          - Merge results, using the non-overlapping portion of each chunk.

        Args:
            waveform: Full mono float32 audio at 44100 Hz.
            text: Full lyrics text.
            duration_sec: Total audio duration in seconds.

        Returns:
            Merged word-level alignment list.
        """
        import numpy as np

        chunk_samples = int(_CHUNK_DURATION_SEC * _SOFA_SAMPLE_RATE)
        overlap_samples = int(_CHUNK_OVERLAP_SEC * _SOFA_SAMPLE_RATE)
        step_samples = chunk_samples - overlap_samples

        # Calculate chunk boundaries
        total_samples = len(waveform)
        chunk_starts: List[int] = []
        pos = 0
        while pos < total_samples:
            chunk_starts.append(pos)
            pos += step_samples
        num_chunks = len(chunk_starts)

        logger.info(
            "Chunking: %.1fs audio → %d chunks (%.0fs each, %.0fs overlap)",
            duration_sec,
            num_chunks,
            _CHUNK_DURATION_SEC,
            _CHUNK_OVERLAP_SEC,
        )

        # Split text proportionally
        text_chunks = self._split_text_for_chunks(text, num_chunks)

        all_words: List[Dict] = []

        for i, (sample_start, chunk_text) in enumerate(
            zip(chunk_starts, text_chunks)
        ):
            sample_end = min(sample_start + chunk_samples, total_samples)
            audio_chunk = waveform[sample_start:sample_end]
            time_offset = sample_start / _SOFA_SAMPLE_RATE

            if not chunk_text.strip():
                logger.debug("Chunk %d: empty text — skipping", i)
                continue

            logger.info(
                "Chunk %d/%d: %.1fs–%.1fs, text=%d chars",
                i + 1,
                num_chunks,
                time_offset,
                sample_end / _SOFA_SAMPLE_RATE,
                len(chunk_text),
            )

            chunk_words = self._align_single(audio_chunk, chunk_text)

            # Offset timestamps by chunk start position
            for word in chunk_words:
                word["start_time"] = round(word["start_time"] + time_offset, 3)
                word["end_time"] = round(word["end_time"] + time_offset, 3)

            # For overlapping regions, only keep words from the earlier chunk
            # whose end_time falls within the non-overlapping portion
            if i < num_chunks - 1:
                # Non-overlapping boundary for this chunk
                boundary = (sample_start + step_samples) / _SOFA_SAMPLE_RATE
                chunk_words = [
                    w for w in chunk_words if w["start_time"] < boundary
                ]

            all_words.extend(chunk_words)

        # Sort by start time (in case of any ordering issues)
        all_words.sort(key=lambda w: w["start_time"])

        logger.info("Chunked alignment complete: %d words total", len(all_words))
        return all_words

    # ------------------------------------------------------------------
    # Resource management
    # ------------------------------------------------------------------

    def release_model(self) -> None:
        """Release ONNX model and G2P to free GPU/CPU memory."""
        if self._infer_engine is not None:
            self._infer_engine.release()
            self._infer_engine = None
            logger.info("Released SOFA ONNX inference engine")

        self._g2p = None
        self._ph_to_idx = None
        gc.collect()

    def __del__(self) -> None:
        """Ensure resources are released on garbage collection."""
        try:
            self.release_model()
        except Exception:
            pass
