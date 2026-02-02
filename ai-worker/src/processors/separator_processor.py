# type: ignore
import os
from typing import Callable, Any

from audio_separator.separator import Separator  # type: ignore

from src.config import TEMP_DIR  # type: ignore
from src.services.s3_service import s3_service  # type: ignore


MODEL_NAME = "mel_band_roformer_kim_ft3_unwa.ckpt"


class SeparatorProcessor:
    model_name: str

    def __init__(self):
        self.model_name: str = MODEL_NAME

    def separate(
        self,
        audio_path: str,
        song_id: str,
        folder_name: str | None = None,
        progress_callback: Callable[[int], None] | None = None,
    ) -> dict[str, object]:
        if folder_name is None:
            folder_name = song_id

        if progress_callback:
            progress_callback(0)

        output_dir = os.path.join(TEMP_DIR, song_id)
        os.makedirs(output_dir, exist_ok=True)

        output_files: list[str] = []
        results: dict[str, str] = {}
        success = False

        try:
            separator: Any = Separator(output_dir=output_dir, output_format="FLAC")
            separator.load_model(self.model_name)  # type: ignore
            output_files = separator.separate(audio_path)  # type: ignore

            # audio-separator may return relative filenames; ensure absolute paths
            output_files = [
                f if os.path.isabs(f) else os.path.join(output_dir, os.path.basename(f))
                for f in output_files
            ]

            for output_file in output_files:
                filename = os.path.basename(output_file)
                if "Vocals" in filename:
                    source_key = "vocals"
                elif "Instrumental" in filename:
                    source_key = "instrumental"
                else:
                    continue

                s3_key = f"songs/{folder_name}/{source_key}.flac"
                url = s3_service.upload_file(output_file, s3_key)
                results[source_key] = url

            success = True
        finally:
            for output_file in output_files:
                if os.path.exists(output_file):
                    try:
                        os.remove(output_file)
                    except OSError:
                        pass

            if os.path.exists(output_dir):
                for file_name in os.listdir(output_dir):
                    file_path = os.path.join(output_dir, file_name)
                    try:
                        os.remove(file_path)
                    except OSError:
                        pass
                try:
                    os.rmdir(output_dir)
                except OSError:
                    pass

            if progress_callback and success:
                progress_callback(100)

        return {
            "vocals_url": results.get("vocals", ""),
            "instrumental_url": results.get("instrumental", ""),
            "all_sources": results,
        }


separator_processor = SeparatorProcessor()
