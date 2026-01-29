import os
import torch
import torchaudio
from typing import Callable, Optional
from demucs_infer.pretrained import get_model
from demucs_infer.apply import apply_model
from src.config import TEMP_DIR
from src.services.s3_service import s3_service


class DemucsProcessor:
    def __init__(self):
        self.model = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def _load_model(self):
        if self.model is None:
            self.model = get_model("htdemucs_ft")
            self.model.to(self.device)

    def separate(self, audio_path: str, song_id: str, folder_name: str = None, progress_callback: Optional[Callable[[int], None]] = None) -> dict:
        if folder_name is None:
            folder_name = song_id
        
        # 시작 진행률 보고
        if progress_callback:
            progress_callback(0)
            
        self._load_model()

        waveform, sample_rate = torchaudio.load(audio_path)

        if sample_rate != self.model.samplerate:
            resampler = torchaudio.transforms.Resample(sample_rate, self.model.samplerate)
            waveform = resampler(waveform)

        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)

        waveform = waveform.unsqueeze(0).to(self.device)

        with torch.no_grad():
            sources = apply_model(self.model, waveform, device=self.device, overlap=0.25, segment=None)

        sources = sources.squeeze(0)
        source_names = self.model.sources

        output_dir = os.path.join(TEMP_DIR, song_id)
        os.makedirs(output_dir, exist_ok=True)

        results = {}
        for i, name in enumerate(source_names):
            output_path = os.path.join(output_dir, f"{name}.wav")
            torchaudio.save(output_path, sources[i].cpu(), self.model.samplerate)

            s3_key = f"songs/{folder_name}/{name}.wav"
            url = s3_service.upload_file(output_path, s3_key)
            results[name] = url

            os.remove(output_path)

        vocals_url = results.get("vocals", "")
        instrumental_parts = ["drums", "bass", "other"]
        instrumental_sources = [sources[source_names.index(p)] for p in instrumental_parts if p in source_names]

        if instrumental_sources:
            instrumental = sum(instrumental_sources)
            instrumental_path = os.path.join(output_dir, "instrumental.wav")
            torchaudio.save(instrumental_path, instrumental.cpu(), self.model.samplerate)

            s3_key = f"songs/{folder_name}/instrumental.wav"
            instrumental_url = s3_service.upload_file(instrumental_path, s3_key)
            results["instrumental"] = instrumental_url

            os.remove(instrumental_path)

        os.rmdir(output_dir)
        
        # 완료 진행률 보고
        if progress_callback:
            progress_callback(100)

        return {
            "vocals_url": vocals_url,
            "instrumental_url": results.get("instrumental", ""),
            "all_sources": results,
        }


demucs_processor = DemucsProcessor()
