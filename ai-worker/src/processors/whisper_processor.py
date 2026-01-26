import os
import json
from faster_whisper import WhisperModel
from typing import List, Dict, Callable, Optional
from src.config import TEMP_DIR
from src.services.s3_service import s3_service


class WhisperProcessor:
    def __init__(self):
        self.model = None

    def _load_model(self):
        if self.model is None:
            # large-v3: 가장 정확한 모델
            self.model = WhisperModel(
                "large-v3",
                device="cuda",
                compute_type="float16",
                download_root="/tmp/whisper_models"
            )

    def extract_lyrics(self, audio_path: str, song_id: str, language: str = "ko", folder_name: str = None, progress_callback: Optional[Callable[[int], None]] = None) -> Dict:
        if folder_name is None:
            folder_name = song_id
            
        self._load_model()

        # 최적화된 transcribe 파라미터
        segments, info = self.model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            
            # VAD 설정 (음성 구간 정확히 감지)
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,  # 무음 최소 지속 시간
                speech_pad_ms=400,            # 음성 패딩
                threshold=0.5,                # VAD 임계값
            ),
            
            # 정확도 향상 파라미터
            beam_size=10,                     # 빔 서치 크기 (기본 5)
            best_of=5,                        # 최적 후보 수
            patience=2.0,                     # 탐색 인내심
            condition_on_previous_text=True,  # 이전 컨텍스트 활용
            
            # 노이즈/반복 필터링
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
            
            # 온도 설정 (0이면 greedy, 높으면 다양성)
            temperature=0.0,
        )

        # segment 단위로 진행률 보고
        segments_list = []
        total_duration = info.duration if info.duration else 1
        
        for segment in segments:
            segments_list.append(segment)
            if progress_callback and info.duration:
                progress = int((segment.end / total_duration) * 100)
                progress_callback(min(progress, 100))
        
        # 세그먼트 처리 및 후처리
        lyrics_lines = self._process_segments(segments_list)
        lyrics_lines = self._postprocess_segments(lyrics_lines)

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
            pass  # 디렉토리가 비어있지 않으면 무시

        full_text = " ".join([line["text"] for line in lyrics_lines])

        return {
            "lyrics_url": lyrics_url,
            "lyrics": lyrics_lines,
            "full_text": full_text,
            "language": info.language,
            "duration": info.duration,
        }

    def _process_segments(self, segments: List) -> List[Dict]:
        """세그먼트를 딕셔너리로 변환"""
        lyrics_lines = []

        for segment in segments:
            line = {
                "start_time": round(segment.start, 3),
                "end_time": round(segment.end, 3),
                "text": segment.text.strip(),
                "words": [],
            }

            if segment.words:
                for word in segment.words:
                    line["words"].append({
                        "start_time": round(word.start, 3),
                        "end_time": round(word.end, 3),
                        "text": word.word.strip(),
                    })

            lyrics_lines.append(line)

        return lyrics_lines

    def _postprocess_segments(self, segments: List[Dict]) -> List[Dict]:
        """후처리: 긴 세그먼트 분할, 짧은 세그먼트 병합"""
        if not segments:
            return segments

        processed = []

        for segment in segments:
            duration = segment["end_time"] - segment["start_time"]

            # 긴 세그먼트 분할 (8초 초과)
            if duration > 8.0 and segment.get("words"):
                chunks = self._split_long_segment(segment)
                processed.extend(chunks)
            # 짧은 세그먼트 병합 (0.3초 미만)
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

    def _split_long_segment(self, segment: Dict) -> List[Dict]:
        """긴 세그먼트를 5초 단위로 분할"""
        words = segment.get("words", [])
        if not words:
            return [segment]

        chunks = []
        current_words = []
        current_start = words[0]["start_time"]

        for i, word in enumerate(words):
            current_words.append(word)
            duration = word["end_time"] - current_start

            # 5초마다 또는 문장 끝에서 분할
            text = word["text"]
            is_sentence_end = any(text.endswith(p) for p in ['.', '?', '!', '。', '？', '！', '~', '♪'])

            if duration >= 5.0 or (is_sentence_end and duration >= 2.0):
                chunks.append({
                    "start_time": round(current_start, 3),
                    "end_time": round(word["end_time"], 3),
                    "text": "".join(w["text"] for w in current_words).strip(),
                    "words": current_words.copy()
                })
                current_words = []
                if i < len(words) - 1:
                    current_start = words[i + 1]["start_time"]

        # 남은 단어 처리
        if current_words:
            chunks.append({
                "start_time": round(current_start, 3),
                "end_time": round(current_words[-1]["end_time"], 3),
                "text": "".join(w["text"] for w in current_words).strip(),
                "words": current_words
            })

        return chunks if chunks else [segment]


whisper_processor = WhisperProcessor()
