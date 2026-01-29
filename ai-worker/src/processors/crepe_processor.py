import os
import json
import numpy as np
import torch
import torchcrepe
import librosa
from typing import Dict, List, Callable, Optional
from src.config import TEMP_DIR
from src.services.s3_service import s3_service


class CrepeProcessor:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.chunk_duration = 60  # seconds - larger chunks since small model uses less VRAM

    def analyze_pitch(self, audio_path: str, song_id: str, folder_name: str = None, progress_callback: Optional[Callable[[int], None]] = None) -> Dict:
        if folder_name is None:
            folder_name = song_id
            
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)
        
        # 청크 단위 처리로 CUDA OOM 방지
        chunk_samples = self.chunk_duration * sr
        total_chunks = max(1, (len(audio) + chunk_samples - 1) // chunk_samples)
        
        all_pitch = []
        all_periodicity = []
        
        for i, start in enumerate(range(0, len(audio), chunk_samples)):
            chunk = audio[start:start + chunk_samples]
            audio_tensor = torch.tensor(chunk).unsqueeze(0).to(self.device)
            
            pitch_chunk, periodicity_chunk = torchcrepe.predict(
                audio_tensor,
                sr,
                hop_length=160,       # Keep 10ms for real-time scoring
                fmin=65,              # C2 - lowest practical singing note
                fmax=1047,            # C6 - highest practical singing note
                model='tiny',         # Fast model, sufficient for karaoke scoring
                device=self.device,
                return_periodicity=True,
            )
            
            all_pitch.append(pitch_chunk.squeeze().cpu().numpy())
            all_periodicity.append(periodicity_chunk.squeeze().cpu().numpy())
            
            # GPU 메모리 해제
            del audio_tensor, pitch_chunk, periodicity_chunk
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            
            # 진행률 보고
            if progress_callback:
                progress_callback(int((i + 1) / total_chunks * 100))
        
        # 결과 병합
        pitch = np.concatenate(all_pitch)
        periodicity = np.concatenate(all_periodicity)
        
        time = np.arange(len(pitch)) * 160 / sr

        pitch_data = self._process_pitch_data(time, pitch, periodicity)

        output_dir = os.path.join(TEMP_DIR, song_id)
        os.makedirs(output_dir, exist_ok=True)

        pitch_path = os.path.join(output_dir, "pitch.json")
        with open(pitch_path, "w", encoding="utf-8") as f:
            json.dump(pitch_data, f, indent=2)

        s3_key = f"songs/{folder_name}/pitch.json"
        pitch_url = s3_service.upload_file(pitch_path, s3_key)

        os.remove(pitch_path)
        os.rmdir(output_dir)

        return {
            "pitch_url": pitch_url,
            "pitch_data": pitch_data,
            "stats": self._calculate_stats(pitch, periodicity),
        }

    def _process_pitch_data(
        self, time: np.ndarray, frequency: np.ndarray, confidence: np.ndarray
    ) -> List[Dict]:
        pitch_points = []

        for i in range(len(time)):
            if confidence[i] > 0.5 and not np.isnan(frequency[i]):
                pitch_points.append({
                    "time": round(float(time[i]), 3),
                    "frequency": round(float(frequency[i]), 2),
                    "confidence": round(float(confidence[i]), 3),
                    "note": self._frequency_to_note(frequency[i]),
                    "midi": self._frequency_to_midi(frequency[i]),
                })

        return pitch_points

    def _frequency_to_midi(self, frequency: float) -> int:
        if frequency <= 0 or np.isnan(frequency):
            return 0
        return int(round(69 + 12 * np.log2(frequency / 440.0)))

    def _frequency_to_note(self, frequency: float) -> str:
        if frequency <= 0 or np.isnan(frequency):
            return ""
        notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        midi = self._frequency_to_midi(frequency)
        note_index = midi % 12
        octave = (midi // 12) - 1
        return f"{notes[note_index]}{octave}"

    def _calculate_stats(self, frequency: np.ndarray, confidence: np.ndarray) -> Dict:
        valid_mask = (confidence > 0.5) & ~np.isnan(frequency)
        valid_frequencies = frequency[valid_mask]

        if len(valid_frequencies) == 0:
            return {"min_freq": 0, "max_freq": 0, "avg_freq": 0, "range_semitones": 0}

        min_freq = float(np.min(valid_frequencies))
        max_freq = float(np.max(valid_frequencies))
        avg_freq = float(np.mean(valid_frequencies))

        range_semitones = 12 * np.log2(max_freq / min_freq) if min_freq > 0 else 0

        return {
            "min_freq": round(min_freq, 2),
            "max_freq": round(max_freq, 2),
            "avg_freq": round(avg_freq, 2),
            "range_semitones": round(float(range_semitones), 1),
            "min_note": self._frequency_to_note(min_freq),
            "max_note": self._frequency_to_note(max_freq),
        }


crepe_processor = CrepeProcessor()
