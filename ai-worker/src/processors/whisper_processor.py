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

import whisperx
import gc
from typing import List, Dict, Callable, Optional
from src.config import TEMP_DIR
from src.services.s3_service import s3_service


class WhisperProcessor:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.compute_type = "float16" if self.device == "cuda" else "int8"
        self.model = None

    def _load_model(self):
        if self.model is None:
            print("[WhisperX] Loading model...")
            # WhisperX 3.3.1은 기본적으로 silero VAD 사용 (pyannote 불필요)
            self.model = whisperx.load_model(
                "large-v3",
                self.device,
                compute_type=self.compute_type,
            )

    def _get_initial_prompt(self, language: str) -> str:
        prompts = {
            "ko": "이것은 한국어 노래 가사입니다. 가사를 정확하게 받아적으세요.",
            "ja": "これは日本語の歌詞です。歌詞を正確に書き起こしてください。",
            "en": "These are song lyrics in English. Transcribe the lyrics accurately.",
            "zh": "这是中文歌词。请准确转录歌词。",
        }
        return prompts.get(language, prompts["en"])

    def extract_lyrics(self, audio_path: str, song_id: str, language: str = "ko", folder_name: Optional[str] = None, progress_callback: Optional[Callable[[int], None]] = None) -> Dict:
        if folder_name is None:
            folder_name = song_id

        if progress_callback:
            progress_callback(5)

        self._load_model()

        if progress_callback:
            progress_callback(10)

        # 오디오 로드
        print(f"[WhisperX] Loading audio: {audio_path}")
        audio = whisperx.load_audio(audio_path)

        if progress_callback:
            progress_callback(15)

        # Transcribe (word_timestamps 포함)
        print("[WhisperX] Transcribing...")
        result = self.model.transcribe(
            audio,
            batch_size=16,
            language=language
        )

        if progress_callback:
            progress_callback(70)

        # pyannote alignment 없이 기본 word timestamps 사용
        # WhisperX transcribe 결과에 이미 word-level timestamps가 포함됨

        if progress_callback:
            progress_callback(80)

        # 결과에서 duration 추출
        duration = len(audio) / 16000  # whisperx는 16kHz로 로드

        # 세그먼트 처리
        segments = result.get("segments", [])
        lyrics_lines = self._process_segments(segments)
        lyrics_lines = self._postprocess_segments(lyrics_lines)
        lyrics_lines = self._clean_lyrics(lyrics_lines)

        if progress_callback:
            progress_callback(90)

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

        return lyrics_lines

    def _postprocess_segments(self, segments: List[Dict]) -> List[Dict]:
        if not segments:
            return segments

        processed = []

        for segment in segments:
            duration = segment["end_time"] - segment["start_time"]

            if duration > 8.0 and segment.get("words"):
                chunks = self._split_long_segment(segment)
                processed.extend(chunks)
            elif duration < 0.3 and processed:
                prev = processed[-1]
                gap = segment["start_time"] - prev["end_time"]
                if gap < 1.0:
                    prev["text"] += " " + segment["text"]
                    prev["end_time"] = segment["end_time"]
                    if segment.get("words"):
                        prev["words"] = prev.get("words", []) + segment["words"]
                else:
                    processed.append(segment)
            else:
                processed.append(segment)

        return processed

    def _clean_lyrics(self, segments: List[Dict]) -> List[Dict]:
        cleaned = []
        
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
                
            segment["text"] = text
            
            if segment.get("words"):
                cleaned_words = []
                for word in segment["words"]:
                    word_text = word["text"].strip()
                    if word_text and len(word_text) >= 1:
                        word["text"] = word_text
                        cleaned_words.append(word)
                segment["words"] = cleaned_words
            
            cleaned.append(segment)
        
        return cleaned

    def _split_long_segment(self, segment: Dict) -> List[Dict]:
        words = segment.get("words", [])
        if not words:
            return [segment]

        chunks = []
        current_words = []
        current_start = words[0]["start_time"]

        for i, word in enumerate(words):
            current_words.append(word)
            duration = word["end_time"] - current_start

            text = word["text"]
            is_sentence_end = any(text.endswith(p) for p in ['.', '?', '!', '。', '？', '！', '~', '♪'])

            if duration >= 5.0 or (is_sentence_end and duration >= 2.0):
                chunks.append({
                    "start_time": round(current_start, 3),
                    "end_time": round(word["end_time"], 3),
                    "text": " ".join(w["text"] for w in current_words).strip(),
                    "words": current_words.copy()
                })
                current_words = []
                if i < len(words) - 1:
                    current_start = words[i + 1]["start_time"]

        if current_words:
            chunks.append({
                "start_time": round(current_start, 3),
                "end_time": round(current_words[-1]["end_time"], 3),
                "text": " ".join(w["text"] for w in current_words).strip(),
                "words": current_words
            })

        return chunks if chunks else [segment]


whisper_processor = WhisperProcessor()
