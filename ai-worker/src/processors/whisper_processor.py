import os
import json
import re
import torch

# PyTorch 2.6+ weights_only 보안 정책 우회 (pyannote/omegaconf 호환성)
# 방법 1: torch.load 패치 - 모든 torch.load 호출에 weights_only=False 적용
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs['weights_only'] = False  # 강제로 False 설정
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

# 방법 2: torch.hub.load도 패치 (silero-vad 로딩용)
_original_hub_load = torch.hub.load
def _patched_hub_load(*args, **kwargs):
    kwargs.setdefault('trust_repo', True)
    return _original_hub_load(*args, **kwargs)
torch.hub.load = _patched_hub_load

# 방법 3: omegaconf 모든 클래스들을 safe globals로 등록
try:
    import omegaconf
    from omegaconf import DictConfig, ListConfig, OmegaConf
    from omegaconf.base import ContainerMetadata, Metadata
    from omegaconf.listconfig import ListConfig as LC
    from omegaconf.dictconfig import DictConfig as DC
    
    safe_classes = [
        DictConfig, ListConfig, OmegaConf, 
        ContainerMetadata, Metadata, LC, DC
    ]
    # omegaconf 모듈의 모든 클래스 추가
    for name in dir(omegaconf):
        obj = getattr(omegaconf, name)
        if isinstance(obj, type):
            safe_classes.append(obj)
    
    torch.serialization.add_safe_globals(safe_classes)
except (ImportError, AttributeError) as e:
    print(f"[WhisperX] Warning: Could not add omegaconf safe globals: {e}")

# Stage 1: faster-whisper for pure text extraction (accuracy focus)
from faster_whisper import WhisperModel as FasterWhisperModel

# Stage 2: WhisperX for word-level alignment only
import whisperx
import gc
from typing import List, Dict, Callable, Optional
from src.config import TEMP_DIR
from src.services.s3_service import s3_service
from src.processors.mfa_processor import mfa_processor


class WhisperProcessor:
    """
    3-Stage Lyrics Extraction Pipeline:
    
    Stage 1: OpenAI Whisper large-v3 (via faster-whisper) - Pure text extraction
    Stage 2: WhisperX - Word-level alignment (text + audio → word timestamps)
    Stage 3: MFA - Phoneme-level precision alignment
    """
    
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.compute_type = "float16" if self.device == "cuda" else "int8"
        # Stage 1: faster-whisper model for text extraction
        self.whisper_model = None
        # Stage 2: WhisperX alignment model (loaded per-language)
        self.align_model = None
        self.align_metadata = None
        self.align_language = None

    def _load_whisper_model(self):
        """Load faster-whisper model for Stage 1 (text extraction)."""
        if self.whisper_model is None:
            print("[Stage 1: Whisper] Loading faster-whisper large-v3 model...")
            self.whisper_model = FasterWhisperModel(
                "large-v3",
                device=self.device,
                compute_type=self.compute_type,
            )
            print("[Stage 1: Whisper] Model loaded successfully")

    def _get_initial_prompt(self, language: str) -> str:
        """Get language-specific prompt for better transcription accuracy."""
        prompts = {
            "ko": "이것은 한국어 노래 가사입니다. 가사를 정확하게 받아적으세요.",
            "ja": "これは日本語の歌詞です。歌詞を正確に書き起こしてください。",
            "en": "These are song lyrics in English. Transcribe the lyrics accurately.",
            "zh": "这是中文歌词。请准确转录歌词。",
        }
        return prompts.get(language, prompts["en"])

    def _transcribe_text_only(self, audio_path: str, language: str) -> tuple[str, str]:
        """
        Stage 1: Pure text extraction using faster-whisper large-v3.
        
        This stage focuses on accuracy - extracting the most accurate text possible
        without worrying about timestamps (those come from Stage 2).
        
        Args:
            audio_path: Path to the audio file
            language: Language code for transcription
            
        Returns:
            Tuple of (transcribed_text, detected_language)
        """
        self._load_whisper_model()
        
        initial_prompt = self._get_initial_prompt(language)
        
        print(f"[Stage 1: Whisper] Transcribing with large-v3 (language={language})...")
        
        # Use faster-whisper for pure text extraction
        segments, info = self.whisper_model.transcribe(
            audio_path,
            language=language,
            initial_prompt=initial_prompt,
            beam_size=5,
            best_of=5,
            temperature=0.0,  # Greedy decoding for consistency
            condition_on_previous_text=True,
            vad_filter=True,  # Filter out non-speech
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=400,
            ),
        )
        
        # Collect all text from segments
        text_parts = []
        for segment in segments:
            text_parts.append(segment.text.strip())
        
        full_text = " ".join(text_parts)
        detected_language = info.language if info.language else language
        
        print(f"[Stage 1: Whisper] Extracted text ({len(full_text)} chars): {full_text[:100]}...")
        print(f"[Stage 1: Whisper] Detected language: {detected_language}")
        
        return full_text, detected_language

    def _align_with_whisperx(self, audio, text: str, language: str) -> List[Dict]:
        """
        Stage 2: Word-level alignment using WhisperX.
        
        Takes the accurate text from Stage 1 and aligns it to the audio
        to get word-level timestamps.
        
        Args:
            audio: Audio array loaded by whisperx.load_audio
            text: Transcribed text from Stage 1
            language: Language code
            
        Returns:
            List of segment dictionaries with word-level timestamps
        """
        print(f"[Stage 2: WhisperX] Aligning text to audio...")
        
        # Create segments structure that WhisperX expects for alignment
        # We need to provide the text in segment format
        segments_for_align = [{"text": text, "start": 0.0, "end": len(audio) / 16000}]
        
        try:
            # Load alignment model if needed (cache by language)
            if self.align_model is None or self.align_language != language:
                print(f"[Stage 2: WhisperX] Loading alignment model for {language}...")
                self.align_model, self.align_metadata = whisperx.load_align_model(
                    language_code=language,
                    device=self.device
                )
                self.align_language = language
            
            # Perform alignment
            result = whisperx.align(
                segments_for_align,
                self.align_model,
                self.align_metadata,
                audio,
                self.device,
                return_char_alignments=False
            )
            
            segments = result.get("segments", [])
            total_words = sum(len(seg.get("words", [])) for seg in segments)
            print(f"[Stage 2: WhisperX] Aligned {total_words} words across {len(segments)} segments")
            
            return segments
            
        except Exception as e:
            print(f"[Stage 2: WhisperX] Alignment failed: {e}")
            # Fallback: return single segment with no word timings
            return [{"text": text, "start": 0.0, "end": len(audio) / 16000, "words": []}]

    def extract_lyrics(self, audio_path: str, song_id: str, language: str = "ko", folder_name: Optional[str] = None, progress_callback: Optional[Callable[[int], None]] = None) -> Dict:
        """
        3-Stage Lyrics Extraction Pipeline:
        
        Stage 1: Whisper large-v3 - Pure text extraction (accuracy focus)
        Stage 2: WhisperX - Word-level alignment (text + audio → word timestamps)
        Stage 3: MFA - Phoneme-level precision alignment
        """
        if folder_name is None:
            folder_name = song_id

        if progress_callback:
            progress_callback(5)

        # ============================================================
        # STAGE 1: Whisper large-v3 - Pure text extraction
        # ============================================================
        print("=" * 60)
        print("[Stage 1: Whisper] Starting pure text extraction...")
        print("=" * 60)
        
        text, detected_language = self._transcribe_text_only(audio_path, language)
        
        if progress_callback:
            progress_callback(30)

        # ============================================================
        # STAGE 2: WhisperX - Word-level alignment
        # ============================================================
        print("=" * 60)
        print("[Stage 2: WhisperX] Starting word-level alignment...")
        print("=" * 60)
        
        # Load audio for WhisperX alignment
        audio = whisperx.load_audio(audio_path)
        duration = len(audio) / 16000  # whisperx loads at 16kHz
        
        segments = self._align_with_whisperx(audio, text, detected_language)
        
        if progress_callback:
            progress_callback(60)

        # Process segments into our format
        print(f"[Stage 2: WhisperX] Processing {len(segments)} segments...")
        lyrics_lines = self._process_segments(segments)
        lyrics_lines = self._postprocess_segments(lyrics_lines, detected_language)
        lyrics_lines = self._clean_lyrics(lyrics_lines, detected_language)
        lyrics_lines = self._validate_segments(lyrics_lines)
        
        print(f"[Stage 2: WhisperX] Produced {len(lyrics_lines)} lyrics lines")

        if progress_callback:
            progress_callback(75)

        # ============================================================
        # STAGE 3: MFA - Phoneme-level precision alignment
        # ============================================================
        print("=" * 60)
        print("[Stage 3: MFA] Starting phoneme-level refinement...")
        print("=" * 60)
        
        lyrics_lines = self._refine_with_mfa(audio_path, lyrics_lines, detected_language)
        
        print(f"[Stage 3: MFA] Refinement complete")

        if progress_callback:
            progress_callback(90)
        
        # Memory cleanup
        gc.collect()
        if self.device == "cuda":
            torch.cuda.empty_cache()

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

        # 메모리 정리
        gc.collect()
        if self.device == "cuda":
            torch.cuda.empty_cache()

        return {
            "lyrics_url": lyrics_url,
            "lyrics": lyrics_lines,
            "full_text": full_text,
            "language": language,
            "duration": duration,
        }

    def _process_segments(self, segments: List[Dict]) -> List[Dict]:
        lyrics_lines = []
        
        # Debug: Print first segment structure
        if segments:
            print(f"[WhisperX] First segment keys: {segments[0].keys()}")
            if "words" in segments[0] and segments[0]["words"]:
                print(f"[WhisperX] First word keys: {segments[0]['words'][0].keys()}")
                print(f"[WhisperX] First word: {segments[0]['words'][0]}")

        for segment in segments:
            text = segment.get("text", "").strip()
            if not text:
                continue

            start_time = segment.get("start", 0)
            end_time = segment.get("end", 0)

            line = {
                "start_time": round(start_time, 3),
                "end_time": round(end_time, 3),
                "text": text,
                "words": [],
            }

            # WhisperX의 word-level timestamps
            words = segment.get("words", [])
            for word in words:
                # WhisperX uses "word" key, not "text"
                word_text = word.get("word", "").strip()
                word_start = word.get("start")
                word_end = word.get("end")
                
                if word_text and word_start is not None and word_end is not None:
                    line["words"].append({
                        "start_time": round(word_start, 3),
                        "end_time": round(word_end, 3),
                        "text": word_text,
                    })

            if line["words"] or line["text"]:
                lyrics_lines.append(line)
        
        # Debug: Print word extraction stats
        total_words = sum(len(l.get("words", [])) for l in lyrics_lines)
        print(f"[WhisperX] Processed {len(lyrics_lines)} segments with {total_words} total words")

        return lyrics_lines

    def _postprocess_segments(self, segments: List[Dict], language: str = "ko") -> List[Dict]:
        """Merge segments to create karaoke-friendly lines (5-15 words per line)."""
        if not segments:
            return segments

        # First, flatten all words from all segments
        all_words = []
        segments_with_words = 0
        segments_without_words = 0
        
        for segment in segments:
            words = segment.get("words", [])
            if words:
                all_words.extend(words)
                segments_with_words += 1
            elif segment.get("text"):
                # If no words, create a pseudo-word from the segment
                all_words.append({
                    "start_time": segment["start_time"],
                    "end_time": segment["end_time"],
                    "text": segment["text"]
                })
                segments_without_words += 1
        
        print(f"[WhisperX] Postprocess: {segments_with_words} segments with words, {segments_without_words} without words")
        print(f"[WhisperX] Total flattened words before filtering: {len(all_words)}")
        
        if not all_words:
            return segments
        
        # Filter out CJK-only words ONLY for English songs
        # This prevents Korean/Chinese/Japanese YouTube subtitles from being mixed in
        # But keeps CJK characters for Korean/Japanese/Chinese songs
        should_filter_cjk = language == "en"
        print(f"[WhisperX] Language: {language}, CJK filtering: {should_filter_cjk}")
        
        filtered_words = []
        for word in all_words:
            word_text = word.get("text", "").strip()
            if not word_text:
                continue
            
            # Only filter CJK for English songs
            if should_filter_cjk:
                # Check if word is CJK-only (Korean, Chinese, Japanese)
                is_cjk_only = bool(re.match(r'^[\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff\u31f0-\u31ff]+[.!?,]*$', word_text))
                if is_cjk_only:
                    print(f"[WhisperX] Filtered CJK word in postprocess: {word_text}")
                    continue
            filtered_words.append(word)
        
        all_words = filtered_words
        print(f"[WhisperX] Total words after CJK filtering: {len(all_words)}")
        
        if not all_words:
            return []
        
        # Sort words by start time
        all_words = sorted(all_words, key=lambda w: w.get("start_time", 0))
        
        # Group words into lines (target: 5-15 words per line)
        MIN_WORDS = 5
        MAX_WORDS = 15
        TARGET_WORDS = 10
        
        lines = []
        current_words = []
        
        for i, word in enumerate(all_words):
            current_words.append(word)
            word_count = len(current_words)
            
            # Check for natural break points
            text = word.get("text", "")
            is_sentence_end = any(text.rstrip().endswith(p) for p in ['.', '?', '!', '。', '？', '！'])
            is_phrase_end = any(text.rstrip().endswith(p) for p in [',', '，', '~', '♪', ';', '；'])
            
            # Check for long pause after this word
            has_long_pause = False
            if i < len(all_words) - 1:
                gap = all_words[i + 1]["start_time"] - word["end_time"]
                has_long_pause = gap > 1.0  # 1 second pause
            
            # Split conditions:
            should_split = (
                word_count >= MAX_WORDS or
                (word_count >= TARGET_WORDS and (is_sentence_end or has_long_pause)) or
                (word_count >= MIN_WORDS and is_sentence_end)
            )
            
            if should_split and current_words:
                lines.append({
                    "start_time": round(current_words[0]["start_time"], 3),
                    "end_time": round(current_words[-1]["end_time"], 3),
                    "text": " ".join(w["text"] for w in current_words).strip(),
                    "words": current_words.copy()
                })
                current_words = []
        
        # Add remaining words
        if current_words:
            lines.append({
                "start_time": round(current_words[0]["start_time"], 3),
                "end_time": round(current_words[-1]["end_time"], 3),
                "text": " ".join(w["text"] for w in current_words).strip(),
                "words": current_words
            })
        
        return lines

    def _validate_segments(self, segments: List[Dict]) -> List[Dict]:
        """Validate and fix segment timing issues."""
        validated = []
        
        for segment in segments:
            # Skip empty segments
            if not segment.get("text", "").strip():
                continue
                
            # Ensure start < end
            if segment["start_time"] >= segment["end_time"]:
                continue
                
            # Validate words timing
            words = segment.get("words", [])
            if words:
                # Sort words by start time
                words = sorted(words, key=lambda w: w.get("start_time", 0))
                
                # Fix word timing to be within segment bounds
                for word in words:
                    word["start_time"] = max(word["start_time"], segment["start_time"])
                    word["end_time"] = min(word["end_time"], segment["end_time"])
                    
                segment["words"] = words
                
            validated.append(segment)
        
        return validated

    def _clean_lyrics(self, segments: List[Dict], language: str = "ko") -> List[Dict]:
        cleaned = []
        
        # Common YouTube subtitle patterns to filter out (any language)
        youtube_patterns = [
            r'자막|제공|배달의민족|한글자막|한효주|시청해주셔서|감사합니다',  # Korean YouTube subtitles
            r'광고를.*포함|유료.*광고|PPL',  # Korean ad disclaimers
            r'字幕|提供|感谢观看|订阅|点赞',  # Chinese YouTube subtitles
            r'字幕|提供|ご視聴|チャンネル登録',  # Japanese YouTube subtitles
            r'subscribe|like.*comment|thanks.*watching',  # English YouTube subtitles
            r'다음.*영상|next.*video',  # "Next video" patterns
        ]
        youtube_regex = re.compile('|'.join(youtube_patterns), re.IGNORECASE)
        
        # Only filter CJK for English songs
        should_filter_cjk = language == "en"
        
        for segment in segments:
            text = segment["text"]
            
            # Remove bracketed content
            text = re.sub(r'\[.*?\]', '', text)
            text = re.sub(r'\(.*?\)', '', text)
            
            # Remove repeated characters
            text = re.sub(r'(.)\1{4,}', r'\1\1\1', text)
            
            # Clean whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            
            if not text or len(text) < 2:
                continue
            
            # Skip music notation only
            if re.match(r'^[♪~\s\.\,]+$', text):
                continue
            
            # Skip YouTube subtitle patterns (always filter these)
            if youtube_regex.search(text):
                print(f"[WhisperX] Filtered YouTube subtitle: {text[:50]}")
                continue
                
            segment["text"] = text
            
            # Clean words - filter out CJK characters ONLY for English songs
            if segment.get("words"):
                cleaned_words = []
                for word in segment["words"]:
                    word_text = word["text"].strip()
                    if not word_text or len(word_text) < 1:
                        continue
                    
                    # Only filter CJK for English songs
                    if should_filter_cjk:
                        is_cjk_only = bool(re.match(r'^[\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff]+$', word_text))
                        if is_cjk_only:
                            print(f"[WhisperX] Filtered CJK word: {word_text}")
                            continue
                    
                    word["text"] = word_text
                    cleaned_words.append(word)
                segment["words"] = cleaned_words
                
                # Rebuild text from cleaned words
                if cleaned_words:
                    segment["text"] = " ".join(w["text"] for w in cleaned_words).strip()
            
            # Skip if text is now empty after cleaning
            if not segment.get("text") or len(segment["text"]) < 2:
                continue
            
            cleaned.append(segment)
        
        return cleaned

    def _split_long_segment(self, segment: Dict) -> List[Dict]:
        """Split a segment with many words into smaller chunks."""
        words = segment.get("words", [])
        if not words or len(words) <= 15:
            return [segment]
        
        # Split into chunks of ~10 words
        chunks = []
        for i in range(0, len(words), 10):
            chunk_words = words[i:i+10]
            if chunk_words:
                chunks.append({
                    "start_time": round(chunk_words[0]["start_time"], 3),
                    "end_time": round(chunk_words[-1]["end_time"], 3),
                    "text": " ".join(w["text"] for w in chunk_words).strip(),
                    "words": chunk_words
                })
        
        return chunks if chunks else [segment]

    def _refine_with_mfa(self, audio_path: str, segments: List[Dict], language: str) -> List[Dict]:
        """
        Stage 3: Refine word-level timings using Montreal Forced Aligner (MFA).
        
        MFA provides phoneme-level alignment for more precise word timings,
        addressing WhisperX's uneven timing issues.
        
        Args:
            audio_path: Path to the audio file
            segments: List of segment dictionaries with words
            language: Language code ("en", "ko", "ja")
            
        Returns:
            Segments with refined word timings, or original segments if MFA fails
        """
        # Check if MFA is available
        if not mfa_processor.is_available():
            print("[Stage 3: MFA] MFA not available, using Stage 2 timings")
            return segments
        
        # Check if language is supported by MFA
        if language not in mfa_processor.LANGUAGE_MODELS:
            print(f"[Stage 3: MFA] Language '{language}' not supported, using Stage 2 timings")
            return segments
        
        try:
            # Extract full text from all segments
            full_text = " ".join([seg["text"] for seg in segments])
            if not full_text.strip():
                print("[Stage 3: MFA] No text to align")
                return segments
            
            print(f"[Stage 3: MFA] Running phoneme-level alignment for {len(segments)} segments...")
            
            # Get MFA word timings
            mfa_words = mfa_processor.align_lyrics(audio_path, full_text, language)
            
            if not mfa_words:
                print("[Stage 3: MFA] No words returned, using Stage 2 timings")
                return segments
            
            print(f"[Stage 3: MFA] Aligned {len(mfa_words)} words, mapping to segments...")
            
            # Map MFA word timings back to our segment structure
            refined_segments = self._map_mfa_words_to_segments(segments, mfa_words)
            
            print(f"[Stage 3: MFA] Phoneme-level refinement complete")
            return refined_segments
            
        except Exception as e:
            print(f"[Stage 3: MFA] Refinement failed: {e}, using Stage 2 timings")
            return segments

    def _map_mfa_words_to_segments(self, segments: List[Dict], mfa_words: List[Dict]) -> List[Dict]:
        """
        Map MFA word timings back to the segment structure.
        
        Strategy: Match words by normalized text, preserving segment boundaries.
        If a word can't be matched, keep the original WhisperX timing.
        
        Args:
            segments: Original segments with WhisperX word timings
            mfa_words: MFA word timings list
            
        Returns:
            Segments with refined word timings from MFA
        """
        # Create a lookup of MFA words by normalized text
        # Use a list to handle duplicate words (same word appearing multiple times)
        mfa_word_queue = []
        for mfa_word in mfa_words:
            normalized = mfa_word["text"].lower().strip()
            mfa_word_queue.append({
                "normalized": normalized,
                "start_time": mfa_word["start_time"],
                "end_time": mfa_word["end_time"],
                "used": False
            })
        
        mfa_idx = 0
        refined_segments = []
        
        for segment in segments:
            refined_segment = {
                "start_time": segment["start_time"],
                "end_time": segment["end_time"],
                "text": segment["text"],
                "words": []
            }
            
            segment_words = segment.get("words", [])
            
            for word in segment_words:
                word_text = word["text"].lower().strip()
                
                # Try to find matching MFA word (sequential matching)
                matched = False
                search_start = mfa_idx
                search_end = min(mfa_idx + 10, len(mfa_word_queue))  # Look ahead up to 10 words
                
                for i in range(search_start, search_end):
                    if mfa_word_queue[i]["used"]:
                        continue
                    
                    mfa_normalized = mfa_word_queue[i]["normalized"]
                    
                    # Check for exact match or close match
                    if mfa_normalized == word_text or mfa_normalized.startswith(word_text) or word_text.startswith(mfa_normalized):
                        # Use MFA timing
                        refined_segment["words"].append({
                            "start_time": mfa_word_queue[i]["start_time"],
                            "end_time": mfa_word_queue[i]["end_time"],
                            "text": word["text"]  # Keep original text
                        })
                        mfa_word_queue[i]["used"] = True
                        mfa_idx = i + 1
                        matched = True
                        break
                
                if not matched:
                    # Keep original WhisperX timing
                    refined_segment["words"].append({
                        "start_time": word["start_time"],
                        "end_time": word["end_time"],
                        "text": word["text"]
                    })
            
            # Update segment start/end times based on refined words
            if refined_segment["words"]:
                refined_segment["start_time"] = refined_segment["words"][0]["start_time"]
                refined_segment["end_time"] = refined_segment["words"][-1]["end_time"]
            
            refined_segments.append(refined_segment)
        
        # Log matching statistics
        used_count = sum(1 for w in mfa_word_queue if w["used"])
        print(f"[Stage 3: MFA] Word matching: {used_count}/{len(mfa_word_queue)} MFA words mapped")
        
        return refined_segments


whisper_processor = WhisperProcessor()
