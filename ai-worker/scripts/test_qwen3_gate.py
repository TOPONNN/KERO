#!/usr/bin/env python3
# coding=utf-8
"""
GATE test script for Qwen3-ForcedAligner on Korean singing voice audio.

This script validates that Qwen3-ForcedAligner-0.6B can:
1. Load the model on GPU
2. Align Korean singing voice audio with lyrics
3. Produce valid timestamps (monotonically increasing, start < end)
4. Output structured results with .text, .start_time, .end_time

Usage:
    python test_qwen3_gate.py --audio path/to/audio.wav --text "가사 텍스트" [--language Korean] [--output results.json]
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

import torch

try:
    from qwen_asr import Qwen3ForcedAligner
except ImportError:
    print("ERROR: qwen-asr package not installed. Install with: pip install qwen-asr>=0.2.0")
    sys.exit(1)


def validate_timestamps(items) -> tuple[bool, List[str]]:
    """
    Validate alignment results.
    
    Checks:
    - All start_time < end_time
    - Timestamps monotonically increasing
    - First start_time >= 0
    
    Returns:
        (is_valid, error_messages)
    """
    errors = []
    
    if not items:
        errors.append("No alignment items returned")
        return False, errors
    
    # Check first start_time >= 0
    if items[0].start_time < 0:
        errors.append(f"First start_time is negative: {items[0].start_time}")
    
    # Check start < end for each item
    for i, item in enumerate(items):
        if item.start_time >= item.end_time:
            errors.append(
                f"Item {i} ({item.text!r}): start_time ({item.start_time}) >= end_time ({item.end_time})"
            )
    
    # Check monotonically increasing
    for i in range(1, len(items)):
        if items[i].start_time < items[i - 1].start_time:
            errors.append(
                f"Item {i} ({items[i].text!r}): start_time ({items[i].start_time}) < "
                f"previous start_time ({items[i - 1].start_time})"
            )
        if items[i].end_time < items[i - 1].end_time:
            errors.append(
                f"Item {i} ({items[i].text!r}): end_time ({items[i].end_time}) < "
                f"previous end_time ({items[i - 1].end_time})"
            )
    
    is_valid = len(errors) == 0
    return is_valid, errors


def print_results(items) -> None:
    """Print alignment results in human-readable format with statistics."""
    print("\n===== Alignment Results =====")
    print(f"Total items: {len(items)}")
    print()
    
    for i, item in enumerate(items):
        print(f"[{i:3d}] {item.text:15s} | {item.start_time:7.3f}s -> {item.end_time:7.3f}s")
    
    # Calculate and print statistics
    if items:
        total_duration = items[-1].end_time - items[0].start_time
        avg_word_duration = total_duration / len(items) if len(items) > 0 else 0
        
        print()
        print("===== Statistics =====")
        print(f"Word count:        {len(items)}")
        print(f"Total duration:    {total_duration:.3f}s")
        print(f"Avg word duration: {avg_word_duration:.3f}s")


def save_results_json(items, output_path: str) -> None:
    """Save alignment results to JSON file."""
    data = [
        {
            "text": item.text,
            "start_time": item.start_time,
            "end_time": item.end_time,
        }
        for item in items
    ]
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"\nResults saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="GATE test for Qwen3-ForcedAligner on Korean singing voice audio"
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
        help="Lyrics text to align",
    )
    parser.add_argument(
        "--language",
        type=str,
        default="Korean",
        help="Language code (default: Korean)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Optional: save results to JSON file",
    )
    
    args = parser.parse_args()
    
    # Validate audio file exists
    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"ERROR: Audio file not found: {args.audio}")
        sys.exit(1)
    
    print("=" * 60)
    print("Qwen3-ForcedAligner GATE Test")
    print("=" * 60)
    print(f"Audio:    {args.audio}")
    print(f"Text:     {args.text}")
    print(f"Language: {args.language}")
    print()
    
    # Load model
    print("[1/3] Loading Qwen3-ForcedAligner-0.6B...")
    try:
        aligner = Qwen3ForcedAligner.from_pretrained(
            "Qwen/Qwen3-ForcedAligner-0.6B",
            dtype=torch.bfloat16,
            device_map="cuda:0",
        )
        print("✓ Model loaded successfully")
    except Exception as e:
        print(f"✗ Failed to load model: {e}")
        sys.exit(1)
    
    # Run alignment
    print("\n[2/3] Running alignment...")
    try:
        results = aligner.align(
            audio=str(args.audio),
            text=args.text,
            language=args.language,
        )
        
        if not results or len(results) == 0:
            print("✗ Alignment returned empty results")
            sys.exit(1)
        
        items = results[0]  # Single sample
        print(f"✓ Alignment completed: {len(items)} items")
    except Exception as e:
        print(f"✗ Alignment failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    # Validate results
    print("\n[3/3] Validating results...")
    is_valid, errors = validate_timestamps(items)
    
    if is_valid:
        print("✓ All validation checks passed")
    else:
        print("✗ Validation failed:")
        for error in errors:
            print(f"  - {error}")
    
    # Print results
    print_results(items)
    
    # Save JSON if requested
    if args.output:
        save_results_json(items, args.output)
    
    # Final status
    print("\n" + "=" * 60)
    if is_valid:
        print("RESULT: PASS")
        print("=" * 60)
        return 0
    else:
        print("RESULT: FAIL")
        print("=" * 60)
        return 1


if __name__ == "__main__":
    sys.exit(main())
