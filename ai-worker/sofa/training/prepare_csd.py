#!/usr/bin/env python3
"""Prepare CSD (Children's Song Dataset) for SOFA Korean training.

Downloads the CSD dataset from Zenodo and converts its annotations
to SOFA transcriptions.csv format with phoneme sequences and durations.

CSD dataset structure (Choi et al., Zenodo record 4916302):
    CSD/
      korean/
        wav/      - 44.1kHz 16-bit mono WAV files (kr001a.wav, kr001b.wav, ...)
        mid/      - Monophonic MIDI transcriptions
        lyric/    - Raw Korean lyrics (Hangul text, one syllable per line)
        txt/      - Romanized IPA phonemes (phonemes joined by _, syllables by space)
        csv/      - Note-level timing: start, end, pitch, syllable
        metadata.json

Each of the 50 Korean songs has two versions (a/b = different keys),
yielding ~100 recordings total.

Output format:
    data/full_label/wavs/song_001.wav
    data/full_label/transcriptions.csv  (columns: name, ph_seq, ph_dur)
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import NamedTuple

# Allow importing KoreanG2P from the project root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from sofa.g2p.korean_g2p import KoreanG2P

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CSD_ZENODO_URL = "https://zenodo.org/records/4916302/files/CSD.zip?download=1"
CSD_ZENODO_RECORD = "4916302"

# Phoneme classification for duration distribution
# Our phoneme set from KoreanG2P:
#   onsets:  g gg n d dd r m b bb s ss j jj ch k t p h
#   vowels:  a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i
#   codas:   K N T L M P NG
#   special: SP AP

VOWEL_PHONEMES = frozenset([
    'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye',
    'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we',
    'wi', 'yu', 'eu', 'ui', 'i',
])

CONSONANT_PHONEMES = frozenset([
    # Onsets
    'g', 'gg', 'n', 'd', 'dd', 'r', 'm', 'b', 'bb',
    's', 'ss', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
    # Codas (uppercase)
    'K', 'N', 'T', 'L', 'M', 'P', 'NG',
])

SILENCE_PHONEMES = frozenset(['SP', 'AP'])

# Duration distribution ratios within a syllable
CONSONANT_RATIO = 0.30  # Each consonant gets share of 30% of syllable duration
VOWEL_RATIO = 0.70      # Each vowel gets share of 70% of syllable duration


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

class NoteAnnotation(NamedTuple):
    """A single note/syllable annotation from CSD CSV."""
    start: float   # seconds
    end: float     # seconds
    pitch: float   # MIDI pitch
    syllable: str  # text (Korean char or romanized)


class TranscriptionRow(NamedTuple):
    """A row in the SOFA transcriptions.csv."""
    name: str
    ph_seq: str   # space-separated phonemes
    ph_dur: str   # space-separated durations in seconds


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def download_csd(dest_dir: Path) -> Path:
    """Download CSD dataset from Zenodo and extract it.

    Args:
        dest_dir: Directory to extract into.

    Returns:
        Path to the extracted CSD root directory.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    zip_path = dest_dir / "CSD.zip"

    if zip_path.exists():
        logger.info("CSD.zip already exists at %s, skipping download", zip_path)
    else:
        logger.info("Downloading CSD from %s ...", CSD_ZENODO_URL)
        logger.info("This may take a while (~1-2 GB)...")
        urllib.request.urlretrieve(CSD_ZENODO_URL, str(zip_path), _download_progress)
        print()  # newline after progress
        logger.info("Download complete: %s", zip_path)

    # Extract
    csd_root = dest_dir / "CSD"
    if csd_root.exists():
        logger.info("CSD already extracted at %s", csd_root)
    else:
        logger.info("Extracting %s ...", zip_path)
        with zipfile.ZipFile(str(zip_path), 'r') as zf:
            zf.extractall(str(dest_dir))
        logger.info("Extraction complete")

    return csd_root


def _download_progress(block_num: int, block_size: int, total_size: int) -> None:
    """Callback for urllib.request.urlretrieve to show progress."""
    downloaded = block_num * block_size
    if total_size > 0:
        pct = min(100.0, downloaded * 100.0 / total_size)
        mb_down = downloaded / (1024 * 1024)
        mb_total = total_size / (1024 * 1024)
        print(f"\r  {pct:5.1f}% ({mb_down:.1f}/{mb_total:.1f} MB)", end="", flush=True)
    else:
        mb_down = downloaded / (1024 * 1024)
        print(f"\r  {mb_down:.1f} MB downloaded", end="", flush=True)


# ---------------------------------------------------------------------------
# CSD parsing
# ---------------------------------------------------------------------------

def find_csd_korean_dir(csd_root: Path) -> Path:
    """Locate the korean subdirectory within the CSD tree.

    Handles variations in directory structure (CSD/korean, CSD/Korean, etc.).
    """
    candidates = [
        csd_root / "korean",
        csd_root / "Korean",
        csd_root / "CSD" / "korean",
        csd_root / "CSD" / "Korean",
    ]
    for c in candidates:
        if c.is_dir():
            return c

    # Fallback: search for a 'korean' directory anywhere under csd_root
    for dirpath, dirnames, _ in os.walk(str(csd_root)):
        for d in dirnames:
            if d.lower() == "korean":
                return Path(dirpath) / d

    raise FileNotFoundError(
        f"Could not find 'korean' directory under {csd_root}. "
        + "Please check the CSD dataset structure."
    )


def parse_csd_csv(csv_path: Path) -> list[NoteAnnotation]:
    """Parse a CSD CSV file with note-level annotations.

    Expected format (no header or with header):
        start_time, end_time, pitch, syllable_text

    Args:
        csv_path: Path to the CSV annotation file.

    Returns:
        List of NoteAnnotation entries sorted by start time.
    """
    notes: list[NoteAnnotation] = []

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for row_idx, row in enumerate(reader):
            if len(row) < 4:
                logger.debug("Skipping short row %d in %s: %s", row_idx, csv_path, row)
                continue

            # Skip header row if present
            try:
                start = float(row[0].strip())
            except ValueError:
                if row_idx == 0:
                    continue  # likely a header
                logger.warning("Cannot parse start time in row %d of %s: %s",
                               row_idx, csv_path, row[0])
                continue

            try:
                end = float(row[1].strip())
                pitch = float(row[2].strip())
            except ValueError:
                logger.warning("Cannot parse row %d in %s", row_idx, csv_path)
                continue

            syllable = row[3].strip()
            notes.append(NoteAnnotation(start=start, end=end, pitch=pitch, syllable=syllable))

    notes.sort(key=lambda n: n.start)
    return notes


def read_korean_lyrics(lyric_path: Path) -> list[str]:
    """Read Korean lyrics file and return list of Hangul syllables.

    The lyric file may contain one syllable per line, or space-separated
    syllables, or full text. We extract individual Hangul characters.

    Args:
        lyric_path: Path to the lyrics text file.

    Returns:
        List of individual Hangul syllable characters.
    """
    text = lyric_path.read_text(encoding='utf-8').strip()
    syllables: list[str] = []
    for char in text:
        if KoreanG2P._is_hangul(char):
            syllables.append(char)
    return syllables


# ---------------------------------------------------------------------------
# Phoneme conversion and duration distribution
# ---------------------------------------------------------------------------

def classify_phoneme(ph: str) -> str:
    """Classify a phoneme as 'consonant', 'vowel', or 'silence'."""
    if ph in SILENCE_PHONEMES:
        return 'silence'
    if ph in VOWEL_PHONEMES:
        return 'vowel'
    if ph in CONSONANT_PHONEMES:
        return 'consonant'
    # Unknown — treat as consonant
    logger.debug("Unknown phoneme '%s', treating as consonant", ph)
    return 'consonant'


def distribute_duration(phonemes: list[str], total_duration: float) -> list[float]:
    """Distribute a syllable's total duration across its phonemes.

    Strategy:
    - Consonants collectively get ~30% of the duration
    - Vowels collectively get ~70% of the duration
    - Within each category, duration is split evenly
    - If only consonants or only vowels, they get 100%

    Args:
        phonemes: List of phoneme strings for one syllable.
        total_duration: Total duration in seconds for this syllable/note.

    Returns:
        List of durations (one per phoneme) summing to total_duration.
    """
    if not phonemes:
        return []

    if len(phonemes) == 1:
        return [total_duration]

    n_consonants = sum(1 for p in phonemes if classify_phoneme(p) == 'consonant')
    n_vowels = sum(1 for p in phonemes if classify_phoneme(p) == 'vowel')

    # Determine effective ratios
    if n_consonants == 0 and n_vowels == 0:
        # All silence or unknown — split evenly
        dur_each = total_duration / len(phonemes)
        return [dur_each] * len(phonemes)

    if n_consonants == 0:
        # Only vowels
        consonant_share = 0.0
        vowel_share = total_duration
    elif n_vowels == 0:
        # Only consonants
        consonant_share = total_duration
        vowel_share = 0.0
    else:
        consonant_share = total_duration * CONSONANT_RATIO
        vowel_share = total_duration * VOWEL_RATIO

    dur_per_consonant = consonant_share / n_consonants if n_consonants > 0 else 0.0
    dur_per_vowel = vowel_share / n_vowels if n_vowels > 0 else 0.0

    durations: list[float] = []
    for ph in phonemes:
        cat = classify_phoneme(ph)
        if cat == 'consonant':
            durations.append(dur_per_consonant)
        elif cat == 'vowel':
            durations.append(dur_per_vowel)
        else:
            # Silence phoneme within syllable — give minimal duration
            durations.append(0.01)

    # Normalize to ensure sum == total_duration
    actual_sum = sum(durations)
    if actual_sum > 0 and abs(actual_sum - total_duration) > 1e-6:
        scale = total_duration / actual_sum
        durations = [d * scale for d in durations]

    return durations


def convert_song(
    g2p: KoreanG2P,
    notes: list[NoteAnnotation],
    korean_syllables: list[str] | None,
    min_silence_gap: float = 0.05,
) -> tuple[list[str], list[float]]:
    """Convert a song's annotations to SOFA phoneme sequence + durations.

    Each note maps to one Korean syllable. We use KoreanG2P to decompose
    each syllable into our phoneme set, then distribute the note's duration
    across those phonemes.

    Gaps between notes are represented as SP (silence) phonemes.

    Args:
        g2p: KoreanG2P instance.
        notes: List of NoteAnnotation from the CSV.
        korean_syllables: List of Hangul syllables from the lyrics file.
            If None, we try to extract Hangul from the CSV syllable column.
        min_silence_gap: Minimum gap (seconds) between notes to insert SP.

    Returns:
        Tuple of (phoneme_list, duration_list).
    """
    all_phonemes: list[str] = []
    all_durations: list[float] = []

    # Start with SP
    if notes and notes[0].start > 0.01:
        all_phonemes.append('SP')
        all_durations.append(notes[0].start)
    else:
        all_phonemes.append('SP')
        all_durations.append(0.05)

    for i, note in enumerate(notes):
        note_duration = note.end - note.start
        if note_duration <= 0:
            logger.warning("Skipping note with non-positive duration: %s", note)
            continue

        # Determine the Korean syllable for this note
        hangul_char = None
        if korean_syllables and i < len(korean_syllables):
            hangul_char = korean_syllables[i]
        else:
            # Try to find a Hangul character in the CSV syllable field
            for ch in note.syllable:
                if KoreanG2P._is_hangul(ch):
                    hangul_char = ch
                    break

        # Convert to phonemes
        if hangul_char:
            syllable_phonemes = g2p._syllable_to_phonemes(hangul_char)
        else:
            # Fallback: treat as silence / breath
            logger.debug("No Hangul syllable for note %d (text='%s'), using AP",
                         i, note.syllable)
            syllable_phonemes = ['AP']

        if not syllable_phonemes:
            syllable_phonemes = ['AP']

        # Distribute note duration across phonemes
        syllable_durations = distribute_duration(syllable_phonemes, note_duration)

        all_phonemes.extend(syllable_phonemes)
        all_durations.extend(syllable_durations)

        # Check for gap before next note → insert SP
        if i + 1 < len(notes):
            gap = notes[i + 1].start - note.end
            if gap > min_silence_gap:
                all_phonemes.append('SP')
                all_durations.append(gap)

    # End with SP
    all_phonemes.append('SP')
    all_durations.append(0.05)

    return all_phonemes, all_durations


# ---------------------------------------------------------------------------
# Output generation
# ---------------------------------------------------------------------------

def process_csd(
    korean_dir: Path,
    output_dir: Path,
    g2p: KoreanG2P,
) -> list[TranscriptionRow]:
    """Process all Korean songs in CSD and generate SOFA training data.

    Args:
        korean_dir: Path to CSD/korean/ directory.
        output_dir: Root output directory (will contain full_label/).
        g2p: KoreanG2P instance.

    Returns:
        List of TranscriptionRow entries written to transcriptions.csv.
    """
    wav_dir = korean_dir / "wav"
    csv_dir = korean_dir / "csv"
    lyric_dir = korean_dir / "lyric"

    if not wav_dir.is_dir():
        raise FileNotFoundError(f"WAV directory not found: {wav_dir}")
    if not csv_dir.is_dir():
        raise FileNotFoundError(f"CSV directory not found: {csv_dir}")

    # Create output directories
    out_label_dir = output_dir / "full_label"
    out_wavs_dir = out_label_dir / "wavs"
    out_wavs_dir.mkdir(parents=True, exist_ok=True)

    # Discover WAV files
    wav_files = sorted(wav_dir.glob("*.wav"))
    if not wav_files:
        raise FileNotFoundError(f"No WAV files found in {wav_dir}")

    logger.info("Found %d WAV files in %s", len(wav_files), wav_dir)

    rows: list[TranscriptionRow] = []
    skipped = 0

    for wav_path in wav_files:
        stem = wav_path.stem  # e.g., "kr001a"

        # Find corresponding CSV
        csv_path = csv_dir / f"{stem}.csv"
        if not csv_path.exists():
            logger.warning("No CSV annotation for %s, skipping", stem)
            skipped += 1
            continue

        # Find corresponding lyrics (optional but preferred)
        korean_syllables = None
        if lyric_dir.is_dir():
            lyric_path = lyric_dir / f"{stem}.txt"
            if not lyric_path.exists():
                # Try alternate extensions
                for ext in ['.lyric', '.lrc']:
                    alt = lyric_dir / f"{stem}{ext}"
                    if alt.exists():
                        lyric_path = alt
                        break
            if lyric_path.exists():
                korean_syllables = read_korean_lyrics(lyric_path)
                logger.debug("Read %d Korean syllables from %s",
                             len(korean_syllables), lyric_path)

        # Parse CSV annotations
        notes = parse_csd_csv(csv_path)
        if not notes:
            logger.warning("No notes parsed from %s, skipping", csv_path)
            skipped += 1
            continue

        # Convert to SOFA format
        try:
            phonemes, durations = convert_song(g2p, notes, korean_syllables)
        except Exception as exc:
            logger.error("Error converting %s: %s", stem, exc)
            skipped += 1
            continue

        if len(phonemes) < 2:
            logger.warning("Too few phonemes for %s, skipping", stem)
            skipped += 1
            continue

        # Validate: phoneme and duration counts must match
        assert len(phonemes) == len(durations), (
            f"Mismatch for {stem}: {len(phonemes)} phonemes vs {len(durations)} durations"
        )

        # Format duration strings (round to 6 decimal places)
        ph_seq_str = " ".join(phonemes)
        ph_dur_str = " ".join(f"{d:.6f}" for d in durations)

        # Copy WAV to output
        out_wav = out_wavs_dir / wav_path.name
        if not out_wav.exists():
            shutil.copy2(str(wav_path), str(out_wav))

        rows.append(TranscriptionRow(
            name=stem,
            ph_seq=ph_seq_str,
            ph_dur=ph_dur_str,
        ))

    logger.info("Processed %d songs, skipped %d", len(rows), skipped)
    return rows


def write_transcriptions_csv(rows: list[TranscriptionRow], output_path: Path) -> None:
    """Write SOFA transcriptions.csv file.

    Format:
        name,ph_seq,ph_dur
        kr001a,SP g a NG SP,0.500000 0.100000 0.200000 0.150000 0.300000
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['name', 'ph_seq', 'ph_dur'])
        for row in sorted(rows, key=lambda r: r.name):
            writer.writerow([row.name, row.ph_seq, row.ph_dur])

    logger.info("Wrote %d entries to %s", len(rows), output_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare CSD (Children's Song Dataset) for SOFA Korean training.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download CSD and prepare training data
  python prepare_csd.py --download --output-dir data

  # Use already-downloaded CSD
  python prepare_csd.py --csd-path /path/to/CSD --output-dir data

  # Specify custom silence gap threshold
  python prepare_csd.py --csd-path /path/to/CSD --min-silence-gap 0.1
        """,
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="data",
        help="Output root directory (default: data)",
    )
    parser.add_argument(
        "--csd-path",
        type=str,
        default=None,
        help="Path to already-downloaded CSD root directory",
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Download CSD from Zenodo (record %s)" % CSD_ZENODO_RECORD,
    )
    parser.add_argument(
        "--download-dir",
        type=str,
        default=None,
        help="Directory for downloaded/extracted CSD (default: temp dir)",
    )
    parser.add_argument(
        "--min-silence-gap",
        type=float,
        default=0.05,
        help="Minimum inter-note gap (seconds) to insert SP (default: 0.05)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging",
    )
    args = parser.parse_args()

    # Setup logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    # Determine CSD root
    csd_root: Path
    cleanup_tmp = False

    if args.csd_path:
        csd_root = Path(args.csd_path)
        if not csd_root.is_dir():
            logger.error("CSD path does not exist: %s", csd_root)
            sys.exit(1)
    elif args.download:
        if args.download_dir:
            dl_dir = Path(args.download_dir)
        else:
            dl_dir = Path(tempfile.mkdtemp(prefix="csd_"))
            cleanup_tmp = True
            logger.info("Using temp directory: %s", dl_dir)
        csd_root = download_csd(dl_dir)
    else:
        parser.error("Either --csd-path or --download is required")
        return  # unreachable, but satisfies type checker

    # Find the korean subdirectory
    try:
        korean_dir = find_csd_korean_dir(csd_root)
    except FileNotFoundError as e:
        logger.error("%s", e)
        sys.exit(1)

    logger.info("Using Korean data from: %s", korean_dir)

    # Initialize G2P
    g2p = KoreanG2P()

    # Process
    output_dir = Path(args.output_dir)
    rows = process_csd(korean_dir, output_dir, g2p)

    if not rows:
        logger.error("No songs were successfully processed!")
        sys.exit(1)

    # Write transcriptions.csv
    transcriptions_path = output_dir / "full_label" / "transcriptions.csv"
    write_transcriptions_csv(rows, transcriptions_path)

    # Summary
    total_duration = 0.0
    total_phonemes = 0
    for row in rows:
        durs = [float(d) for d in row.ph_dur.split()]
        total_duration += sum(durs)
        total_phonemes += len(durs)

    logger.info("=" * 60)
    logger.info("CSD preparation complete!")
    logger.info("  Songs processed:  %d", len(rows))
    logger.info("  Total phonemes:   %d", total_phonemes)
    logger.info("  Total duration:   %.1f seconds (%.1f minutes)",
                total_duration, total_duration / 60)
    logger.info("  Output WAVs:      %s", output_dir / "full_label" / "wavs")
    logger.info("  Transcriptions:   %s", transcriptions_path)
    logger.info("=" * 60)

    if cleanup_tmp:
        logger.info("Note: Downloaded CSD is in temp dir %s", csd_root.parent)
        logger.info("      Delete it manually when no longer needed.")


if __name__ == "__main__":
    main()
