import os
import json
import re
from faster_whisper import WhisperModel
from typing import List, Dict, Callable, Optional
from src.config import TEMP_DIR
from src.services.s3_service import s3_service


class WhisperProcessor:
    def __init__(self):
        self.model = None

    def _load_model(self):
        if self.model is None:
            self.model = WhisperModel(
                "large-v3",
                device="cuda",
                compute_type="float16",
                download_root="/tmp/whisper_models"
            )

    def _get_initial_prompt(self, language: str) -> str:
        prompts = {
            "ko": "이것은 한국어 노래 가사입니다. 가사를 정확하게 받아적으세요.",
            "ja": "これは日本語の歌詞です。歌詞を正確に書き起こしてください。",
            "en": "These are song lyrics in English. Transcribe the lyrics accurately.",
            "zh": "这是中文歌词。请准确转录歌词。",
        }
        return prompts.get(language, prompts["en"])

    def extract_lyrics(self, audio_path: str, song_id: str, language: str = "ko", folder_name: str = None, progress_callback: Optional[Callable[[int], None]] = None) -> Dict:
        if folder_name is None:
            folder_name = song_id
            
        self._load_model()

        initial_prompt = self._get_initial_prompt(language)

        segments, info = self.model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            
            initial_prompt=initial_prompt,
            
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=200,
                threshold=0.35,
                min_speech_duration_ms=100,
                max_speech_duration_s=float("inf"),
            ),
            
            beam_size=5,
            best_of=5,
            patience=1.5,
            
            condition_on_previous_text=True,
            prompt_reset_on_temperature=0.5,
            
            no_speech_threshold=0.5,
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
            
            temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
            
            hallucination_silence_threshold=0.5,
            
            repetition_penalty=1.1,
            no_repeat_ngram_size=3,
            
            prepend_punctuations="\"'"¿([{-「『",
            append_punctuations="\"'.。,，!!?:：;；」』)]}、♪~…",
        )

        segments_list = []
        total_duration = info.duration if info.duration else 1
        
        for segment in segments:
            segments_list.append(segment)
            if progress_callback and info.duration:
                progress = int((segment.end / total_duration) * 100)
                progress_callback(min(progress, 100))
        
        lyrics_lines = self._process_segments(segments_list)
        lyrics_lines = self._postprocess_segments(lyrics_lines)
        lyrics_lines = self._clean_lyrics(lyrics_lines)

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

        full_text = " ".join([line["text"] for line in lyrics_lines])

        return {
            "lyrics_url": lyrics_url,
            "lyrics": lyrics_lines,
            "full_text": full_text,
            "language": info.language,
            "duration": info.duration,
        }

    def _process_segments(self, segments: List) -> List[Dict]:
        lyrics_lines = []

        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
                
            line = {
                "start_time": round(segment.start, 3),
                "end_time": round(segment.end, 3),
                "text": text,
                "words": [],
            }

            if segment.words:
                for word in segment.words:
                    word_text = word.word.strip()
                    if word_text:
                        line["words"].append({
                            "start_time": round(word.start, 3),
                            "end_time": round(word.end, 3),
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
                    "text": "".join(w["text"] for w in current_words).strip(),
                    "words": current_words.copy()
                })
                current_words = []
                if i < len(words) - 1:
                    current_start = words[i + 1]["start_time"]

        if current_words:
            chunks.append({
                "start_time": round(current_start, 3),
                "end_time": round(current_words[-1]["end_time"], 3),
                "text": "".join(w["text"] for w in current_words).strip(),
                "words": current_words
            })

        return chunks if chunks else [segment]


whisper_processor = WhisperProcessor()
