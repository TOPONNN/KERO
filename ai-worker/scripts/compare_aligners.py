#!/usr/bin/env python3
# coding=utf-8
"""
A/B Comparison: WhisperX vs Qwen3-ForcedAligner alignment.

Runs the same audio through both alignment pipelines and compares
word-level timing results side by side.

Usage:
    python compare_aligners.py --audio vocals.wav --text "가사 텍스트" --language Korean
    python compare_aligners.py --audio vocals.wav --text lyrics.txt --language Korean --output comparison.json
"""

import argparse
import json
import time
import sys
import os
import statistics
from pathlib import Path
from typing import List, Dict, Optional, Tuple

# Add project root to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch


def run_qwen3(audio_path: str, text: str, language: str) -> Tuple[List[Dict], float]:
    """Run Qwen3-ForcedAligner and return (words, elapsed_seconds)."""
    try:
        from src.processors.qwen3_aligner import Qwen3Aligner
        
        aligner = Qwen3Aligner()
        start = time.time()
        words = aligner.align_words(audio_path, text, language)
        elapsed = time.time() - start
        aligner.release_model()
        return words, elapsed
    except Exception as e:
        print(f"[Qwen3] Error: {e}")
        import traceback
        traceback.print_exc()
        return [], 0.0


def run_whisperx(audio_path: str, text: str, language_code: str) -> Tuple[List[Dict], float]:
    """Run WhisperX alignment pipeline and return (words, elapsed_seconds)."""
    try:
        from src.processors.whisperx_processor import LyricsProcessor
        
        proc = LyricsProcessor()
        start = time.time()
        
        # Step 1: Transcribe with WhisperX for rough timing
        segments = proc._whisperx_transcribe(audio_path, language_code)
        
        if not segments:
            print("[WhisperX] No segments from transcription")
            elapsed = time.time() - start
            proc._release_whisperx_model()
            return [], elapsed
        
        # Step 2: Map API lyrics lines to audio regions
        api_segments = proc._map_lines_to_audio(text, segments)
        
        # Step 3: Force alignment
        aligned = proc._whisperx_align_segments(audio_path, api_segments, language_code)
        
        # Step 4: Build lyrics from aligned
        lyrics = proc._build_lyrics_from_aligned(api_segments, aligned)
        
        elapsed = time.time() - start
        proc._release_whisperx_model()
        
        # Flatten words from all lines
        all_words = []
        for line in lyrics:
            for word in line.get("words", []):
                all_words.append(word)
        
        return all_words, elapsed
    except Exception as e:
        print(f"[WhisperX] Error: {e}")
        import traceback
        traceback.print_exc()
        return [], 0.0


def compare_words(qwen3_words: List[Dict], whisperx_words: List[Dict]) -> Dict:
    """Compare word timings and compute statistics."""
    stats = {
        "qwen3_count": len(qwen3_words),
        "whisperx_count": len(whisperx_words),
        "matched_count": 0,
        "start_time_diffs_ms": [],
        "end_time_diffs_ms": [],
    }
    
    # Compare up to the minimum count
    min_count = min(len(qwen3_words), len(whisperx_words))
    stats["matched_count"] = min_count
    
    for i in range(min_count):
        q_word = qwen3_words[i]
        w_word = whisperx_words[i]
        
        q_start = q_word.get("start_time", 0.0)
        q_end = q_word.get("end_time", 0.0)
        w_start = w_word.get("start_time", 0.0)
        w_end = w_word.get("end_time", 0.0)
        
        start_diff_ms = (w_start - q_start) * 1000
        end_diff_ms = (w_end - q_end) * 1000
        
        stats["start_time_diffs_ms"].append(start_diff_ms)
        stats["end_time_diffs_ms"].append(end_diff_ms)
    
    # Compute statistics
    if stats["start_time_diffs_ms"]:
        diffs = stats["start_time_diffs_ms"]
        stats["start_time_stats"] = {
            "mean_ms": round(statistics.mean(diffs), 2),
            "median_ms": round(statistics.median(diffs), 2),
            "stdev_ms": round(statistics.stdev(diffs), 2) if len(diffs) > 1 else 0.0,
            "min_ms": round(min(diffs), 2),
            "max_ms": round(max(diffs), 2),
        }
    
    if stats["end_time_diffs_ms"]:
        diffs = stats["end_time_diffs_ms"]
        stats["end_time_stats"] = {
            "mean_ms": round(statistics.mean(diffs), 2),
            "median_ms": round(statistics.median(diffs), 2),
            "stdev_ms": round(statistics.stdev(diffs), 2) if len(diffs) > 1 else 0.0,
            "min_ms": round(min(diffs), 2),
            "max_ms": round(max(diffs), 2),
        }
    
    return stats


def print_comparison_table(qwen3_words: List[Dict], whisperx_words: List[Dict]) -> None:
    """Print side-by-side comparison table."""
    min_count = min(len(qwen3_words), len(whisperx_words))
    
    if min_count == 0:
        print("\n[Comparison] No words to compare")
        return
    
    print("\n" + "=" * 120)
    print("WORD-LEVEL TIMING COMPARISON")
    print("=" * 120)
    
    # Header
    header = (
        f"{'#':<4} | "
        f"{'Word':<15} | "
        f"{'Qwen3 Start':<12} | "
        f"{'Qwen3 End':<12} | "
        f"{'WhisperX Start':<15} | "
        f"{'WhisperX End':<15} | "
        f"{'Start Diff (ms)':<15} | "
        f"{'End Diff (ms)':<15}"
    )
    print(header)
    print("-" * 120)
    
    for i in range(min_count):
        q_word = qwen3_words[i]
        w_word = whisperx_words[i]
        
        q_text = q_word.get("text", "")[:15]
        q_start = q_word.get("start_time", 0.0)
        q_end = q_word.get("end_time", 0.0)
        w_start = w_word.get("start_time", 0.0)
        w_end = w_word.get("end_time", 0.0)
        
        start_diff_ms = (w_start - q_start) * 1000
        end_diff_ms = (w_end - q_end) * 1000
        
        # Format diff with sign
        start_diff_str = f"{start_diff_ms:+.1f}"
        end_diff_str = f"{end_diff_ms:+.1f}"
        
        row = (
            f"{i+1:<4} | "
            f"{q_text:<15} | "
            f"{q_start:<12.3f} | "
            f"{q_end:<12.3f} | "
            f"{w_start:<15.3f} | "
            f"{w_end:<15.3f} | "
            f"{start_diff_str:<15} | "
            f"{end_diff_str:<15}"
        )
        print(row)
    
    print("=" * 120)


def print_statistics(stats: Dict) -> None:
    """Print comparison statistics."""
    print("\n" + "=" * 80)
    print("COMPARISON STATISTICS")
    print("=" * 80)
    
    print(f"\nWord Counts:")
    print(f"  Qwen3:    {stats['qwen3_count']} words")
    print(f"  WhisperX: {stats['whisperx_count']} words")
    print(f"  Matched:  {stats['matched_count']} words")
    
    if "start_time_stats" in stats:
        st = stats["start_time_stats"]
        print(f"\nStart Time Differences (WhisperX - Qwen3):")
        print(f"  Mean:     {st['mean_ms']:+.2f} ms")
        print(f"  Median:   {st['median_ms']:+.2f} ms")
        print(f"  Stdev:    {st['stdev_ms']:.2f} ms")
        print(f"  Min:      {st['min_ms']:+.2f} ms")
        print(f"  Max:      {st['max_ms']:+.2f} ms")
    
    if "end_time_stats" in stats:
        et = stats["end_time_stats"]
        print(f"\nEnd Time Differences (WhisperX - Qwen3):")
        print(f"  Mean:     {et['mean_ms']:+.2f} ms")
        print(f"  Median:   {et['median_ms']:+.2f} ms")
        print(f"  Stdev:    {et['stdev_ms']:.2f} ms")
        print(f"  Min:      {et['min_ms']:+.2f} ms")
        print(f"  Max:      {et['max_ms']:+.2f} ms")
    
    print("=" * 80)


def main():
    parser = argparse.ArgumentParser(
        description="A/B comparison of WhisperX vs Qwen3-ForcedAligner alignment"
    )
    parser.add_argument(
        "--audio",
        type=str,
        required=True,
        help="Path to audio file (WAV, FLAC, OGG, etc.)",
    )
    parser.add_argument(
        "--text",
        type=str,
        required=True,
        help="Lyrics text to align (can be a file path or inline string)",
    )
    parser.add_argument(
        "--language",
        type=str,
        default="Korean",
        help="Qwen3 language name (default: Korean)",
    )
    parser.add_argument(
        "--language-code",
        type=str,
        default="ko",
        help="WhisperX language code (default: ko)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Optional: save full comparison results to JSON file",
    )
    
    args = parser.parse_args()
    
    # Validate audio file exists
    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"ERROR: Audio file not found: {args.audio}")
        sys.exit(1)
    
    # Load text from file if it's a path, otherwise use as inline string
    text = args.text
    text_path = Path(args.text)
    if text_path.exists() and text_path.is_file():
        try:
            with open(text_path, "r", encoding="utf-8") as f:
                text = f.read().strip()
            print(f"[Main] Loaded text from file: {args.text}")
        except Exception as e:
            print(f"[Main] Failed to read text file: {e}")
            sys.exit(1)
    
    print("=" * 80)
    print("A/B Comparison: WhisperX vs Qwen3-ForcedAligner")
    print("=" * 80)
    print(f"Audio:           {args.audio}")
    print(f"Text length:     {len(text)} chars")
    print(f"Language:        {args.language} (Qwen3) / {args.language_code} (WhisperX)")
    print()
    
    # Run Qwen3
    print("[1/2] Running Qwen3-ForcedAligner...")
    qwen3_words, qwen3_time = run_qwen3(str(audio_path), text, args.language)
    print(f"✓ Qwen3 completed: {len(qwen3_words)} words in {qwen3_time:.2f}s")
    
    # Run WhisperX
    print("\n[2/2] Running WhisperX...")
    whisperx_words, whisperx_time = run_whisperx(str(audio_path), text, args.language_code)
    print(f"✓ WhisperX completed: {len(whisperx_words)} words in {whisperx_time:.2f}s")
    
    # Compare
    print("\n[3/3] Comparing results...")
    stats = compare_words(qwen3_words, whisperx_words)
    
    # Print table
    print_comparison_table(qwen3_words, whisperx_words)
    
    # Print statistics
    print_statistics(stats)
    
    # Print timing
    print(f"\nProcessing Time:")
    print(f"  Qwen3:    {qwen3_time:.2f}s")
    print(f"  WhisperX: {whisperx_time:.2f}s")
    print(f"  Speedup:  {whisperx_time / qwen3_time:.2f}x" if qwen3_time > 0 else "  Speedup:  N/A")
    
    # Save JSON if requested
    if args.output:
        output_data = {
            "audio": str(audio_path),
            "text_length": len(text),
            "language": args.language,
            "language_code": args.language_code,
            "qwen3": {
                "word_count": len(qwen3_words),
                "elapsed_seconds": round(qwen3_time, 3),
                "words": qwen3_words,
            },
            "whisperx": {
                "word_count": len(whisperx_words),
                "elapsed_seconds": round(whisperx_time, 3),
                "words": whisperx_words,
            },
            "comparison": stats,
        }
        
        try:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(output_data, f, ensure_ascii=False, indent=2)
            print(f"\n✓ Results saved to: {args.output}")
        except Exception as e:
            print(f"\n✗ Failed to save results: {e}")
    
    print("\n" + "=" * 80)
    print("COMPARISON COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    sys.exit(main())
