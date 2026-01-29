"""
MFA (Montreal Forced Aligner) Processor for precise word-level timing alignment.

Provides phoneme-level alignment for karaoke lyrics, addressing WhisperX's
uneven word timing issues (some words 4-5 seconds, others 0.06 seconds).
"""

import os
import re
import shutil
import subprocess
import uuid
from typing import Dict, List

from src.config import TEMP_DIR


class MFAProcessor:
    """
    Montreal Forced Aligner processor for precise word-level timing.
    
    MFA provides phoneme-level alignment which results in much more
    accurate word timings compared to WhisperX's alignment.
    """
    
    # Language to MFA model mapping
    # Format: language_code -> (acoustic_model, dictionary)
    LANGUAGE_MODELS = {
        "en": ("english_us_arpa", "english_us_arpa"),
        "ko": ("korean_mfa", "korean_mfa"),
        "ja": ("japanese_mfa", "japanese_mfa"),
    }
    
    # Absolute path to MFA binary
    MFA_BIN = "/opt/conda/envs/mfa/bin/mfa"
    
    def __init__(self):
        self.temp_base = os.path.join(TEMP_DIR, "mfa")
        os.makedirs(self.temp_base, exist_ok=True)
    
    def _get_mfa_env(self):
        """Get environment with MFA conda paths."""
        env = os.environ.copy()
        conda_paths = "/opt/conda/envs/mfa/bin:/opt/conda/bin"
        env["PATH"] = conda_paths + ":" + env.get("PATH", "")
        return env
    
    def align_lyrics(
        self,
        audio_path: str,
        text: str,
        language: str = "en"
    ) -> List[Dict]:
        """
        Align lyrics text to audio using Montreal Forced Aligner.
        
        Args:
            audio_path: Path to the audio file (WAV format preferred)
            text: The lyrics text to align
            language: Language code ("en", "ko", "ja")
            
        Returns:
            List of word timing dictionaries:
            [
                {"start_time": 0.5, "end_time": 0.8, "text": "hello"},
                {"start_time": 0.9, "end_time": 1.2, "text": "world"},
            ]
        """
        # Validate language
        if language not in self.LANGUAGE_MODELS:
            print(f"[MFA] Unsupported language '{language}', falling back to English")
            language = "en"
        
        acoustic_model, dictionary = self.LANGUAGE_MODELS[language]
        
        # Create unique working directory
        session_id = str(uuid.uuid4())[:8]
        corpus_dir = os.path.join(self.temp_base, f"corpus_{session_id}")
        output_dir = os.path.join(self.temp_base, f"output_{session_id}")
        
        try:
            # Setup corpus directory structure
            os.makedirs(corpus_dir, exist_ok=True)
            os.makedirs(output_dir, exist_ok=True)
            
            # Prepare corpus files
            utterance_id = "utterance"
            self._prepare_corpus(corpus_dir, utterance_id, audio_path, text)
            
            # Run MFA alignment
            success = self._run_mfa_align(
                corpus_dir, dictionary, acoustic_model, output_dir
            )
            
            if not success:
                print("[MFA] Alignment failed, returning empty result")
                return []
            
            # Parse TextGrid output
            textgrid_path = os.path.join(output_dir, f"{utterance_id}.TextGrid")
            if not os.path.exists(textgrid_path):
                print(f"[MFA] TextGrid not found at {textgrid_path}")
                return []
            
            words = self._parse_textgrid(textgrid_path)
            print(f"[MFA] Extracted {len(words)} words from alignment")
            
            return words
            
        except Exception as e:
            print(f"[MFA] Error during alignment: {e}")
            return []
            
        finally:
            # Cleanup temporary directories
            self._cleanup(corpus_dir, output_dir)
    
    def _prepare_corpus(
        self,
        corpus_dir: str,
        utterance_id: str,
        audio_path: str,
        text: str
    ) -> None:
        """
        Prepare MFA corpus directory with audio and transcript files.
        
        MFA expects:
        - <corpus_dir>/<utterance_id>.wav (audio file)
        - <corpus_dir>/<utterance_id>.lab (text file with transcript)
        """
        # Copy/link audio file
        audio_dest = os.path.join(corpus_dir, f"{utterance_id}.wav")
        
        if audio_path.lower().endswith('.wav'):
            # Direct copy for WAV files
            shutil.copy2(audio_path, audio_dest)
        else:
            # Convert to WAV using ffmpeg if needed
            try:
                subprocess.run(
                    [
                        "ffmpeg", "-y", "-i", audio_path,
                        "-ar", "16000", "-ac", "1",
                        audio_dest
                    ],
                    capture_output=True,
                    check=True
                )
            except subprocess.CalledProcessError as e:
                print(f"[MFA] FFmpeg conversion failed: {e.stderr.decode()}")
                raise
        
        # Write transcript file (.lab format)
        lab_path = os.path.join(corpus_dir, f"{utterance_id}.lab")
        with open(lab_path, "w", encoding="utf-8") as f:
            # Clean text for MFA (remove special characters that might cause issues)
            clean_text = self._clean_text_for_mfa(text)
            f.write(clean_text)
        
        print(f"[MFA] Prepared corpus: {audio_dest}, {lab_path}")
    
    def _clean_text_for_mfa(self, text: str) -> str:
        """
        Clean text for MFA processing.
        
        MFA works best with plain text without special characters.
        """
        # Remove bracketed content
        text = re.sub(r'\[.*?\]', '', text)
        text = re.sub(r'\(.*?\)', '', text)
        
        # Remove music notation
        text = re.sub(r'[♪~]', '', text)
        
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
    
    def _run_mfa_align(
        self,
        corpus_dir: str,
        dictionary: str,
        acoustic_model: str,
        output_dir: str
    ) -> bool:
        """
        Run MFA alignment command.
        
        Command: mfa align <corpus_dir> <dictionary> <acoustic_model> <output_dir>
        """
        cmd = [
            self.MFA_BIN, "align",
            corpus_dir,
            dictionary,
            acoustic_model,
            output_dir,
            "--clean",  # Clean up temporary files
            "--overwrite",  # Overwrite existing output
        ]
        
        print(f"[MFA] Running: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout
                env=self._get_mfa_env()
            )
            
            if result.returncode != 0:
                print(f"[MFA] Alignment failed with code {result.returncode}")
                print(f"[MFA] stderr: {result.stderr}")
                return False
            
            print("[MFA] Alignment completed successfully")
            return True
            
        except subprocess.TimeoutExpired:
            print("[MFA] Alignment timed out after 5 minutes")
            return False
        except FileNotFoundError:
            print("[MFA] MFA command not found. Is MFA installed?")
            return False
        except Exception as e:
            print(f"[MFA] Unexpected error running MFA: {e}")
            return False
    
    def _parse_textgrid(self, textgrid_path: str) -> List[Dict]:
        """
        Parse TextGrid file to extract word-level timings.
        
        TextGrid format (simplified):
        ```
        File type = "ooTextFile"
        Object class = "TextGrid"
        xmin = 0
        xmax = 10.5
        tiers? <exists>
        size = 2
        item []:
            item [1]:
                class = "IntervalTier"
                name = "words"
                xmin = 0
                xmax = 10.5
                intervals: size = 5
                    intervals [1]:
                        xmin = 0
                        xmax = 0.5
                        text = ""
                    intervals [2]:
                        xmin = 0.5
                        xmax = 0.8
                        text = "hello"
        ```
        """
        words = []
        
        try:
            with open(textgrid_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            # Find the "words" tier
            # Look for intervals section within the words tier
            words_tier_match = re.search(
                r'name\s*=\s*"words".*?intervals:\s*size\s*=\s*\d+(.*?)(?=item\s*\[\d+\]:|$)',
                content,
                re.DOTALL | re.IGNORECASE
            )
            
            if not words_tier_match:
                print("[MFA] Could not find 'words' tier in TextGrid")
                # Try to find any interval tier
                words_tier_match = re.search(
                    r'class\s*=\s*"IntervalTier".*?intervals:\s*size\s*=\s*\d+(.*?)(?=item\s*\[\d+\]:|$)',
                    content,
                    re.DOTALL | re.IGNORECASE
                )
            
            if not words_tier_match:
                print("[MFA] Could not find any IntervalTier in TextGrid")
                return []
            
            intervals_section = words_tier_match.group(1)
            
            # Parse individual intervals
            # Pattern: intervals [N]: xmin = X xmax = Y text = "..."
            interval_pattern = re.compile(
                r'intervals\s*\[\d+\]:\s*'
                r'xmin\s*=\s*([\d.]+)\s*'
                r'xmax\s*=\s*([\d.]+)\s*'
                r'text\s*=\s*"([^"]*)"',
                re.DOTALL
            )
            
            for match in interval_pattern.finditer(intervals_section):
                xmin = float(match.group(1))
                xmax = float(match.group(2))
                text = match.group(3).strip()
                
                # Skip empty intervals (silence/pauses)
                if not text:
                    continue
                
                words.append({
                    "start_time": round(xmin, 3),
                    "end_time": round(xmax, 3),
                    "text": text
                })
            
        except Exception as e:
            print(f"[MFA] Error parsing TextGrid: {e}")
        
        return words
    
    def _cleanup(self, *dirs: str) -> None:
        """Clean up temporary directories."""
        for dir_path in dirs:
            if dir_path and os.path.exists(dir_path):
                try:
                    shutil.rmtree(dir_path)
                    print(f"[MFA] Cleaned up: {dir_path}")
                except Exception as e:
                    print(f"[MFA] Failed to cleanup {dir_path}: {e}")
    
    def is_available(self) -> bool:
        """Check if MFA is available on the system."""
        try:
            result = subprocess.run(
                [self.MFA_BIN, "version"],
                capture_output=True,
                text=True,
                timeout=30,
                env=self._get_mfa_env()
            )
            if result.returncode == 0:
                print(f"[MFA] Available: {result.stdout.strip()}")
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        except Exception as e:
            print(f"[MFA] Error checking availability: {e}")
        
        print("[MFA] Not available on this system")
        return False


# Singleton instance
mfa_processor = MFAProcessor()
