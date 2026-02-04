"""
Korean Grapheme-to-Phoneme converter for SOFA forced aligner.

Pure Python implementation using Unicode math for Hangul decomposition.
No external dependencies required.
"""

from __future__ import annotations


class KoreanG2P:
    """Korean Grapheme-to-Phoneme converter for SOFA forced aligner.

    Converts Korean text (Hangul) to a phoneme sequence suitable for
    SOFA's forced alignment pipeline. Uses Unicode block arithmetic
    to decompose Hangul syllables into onset/nucleus/coda components.

    No pronunciation rules are applied (no 연음, 경음화, etc.) —
    this is a direct grapheme-level decomposition.
    """

    # 19 onset (초성) consonants
    ONSET_PHONEMES: list[str] = [
        'g', 'gg', 'n', 'd', 'dd', 'r', 'm', 'b', 'bb',
        's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
    ]

    # 21 nucleus (중성) vowels
    NUCLEUS_PHONEMES: list[str] = [
        'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye',
        'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we',
        'wi', 'yu', 'eu', 'ui', 'i',
    ]

    # 28 coda (종성) consonants — index 0 means no coda
    # Codas use representative (대표음) uppercase phonemes
    CODA_PHONEMES: list[str] = [
        '',   # 0: no coda
        'K',  # 1: ㄱ
        'K',  # 2: ㄲ
        'K',  # 3: ㄳ
        'N',  # 4: ㄴ
        'N',  # 5: ㄵ
        'N',  # 6: ㄶ
        'T',  # 7: ㄷ
        'L',  # 8: ㄹ
        'L',  # 9: ㄺ
        'L',  # 10: ㄻ
        'L',  # 11: ㄼ
        'L',  # 12: ㄽ
        'L',  # 13: ㄾ
        'L',  # 14: ㄿ
        'L',  # 15: ㅀ
        'M',  # 16: ㅁ
        'P',  # 17: ㅂ
        'P',  # 18: ㅄ
        'T',  # 19: ㅅ
        'T',  # 20: ㅆ
        'NG', # 21: ㅇ
        'T',  # 22: ㅈ
        'T',  # 23: ㅊ
        'K',  # 24: ㅋ
        'T',  # 25: ㅌ
        'P',  # 26: ㅍ
        'T',  # 27: ㅎ
    ]

    def __init__(self, **kwargs: object) -> None:
        pass

    def _g2p(self, input_text: str) -> tuple[list[str], list[str], list[int]]:
        """Convert Korean text to SOFA phoneme sequence.

        Args:
            input_text: Korean text (e.g., "안녕하세요 반갑습니다")

        Returns:
            Tuple of:
                ph_seq: list[str] — phoneme sequence starting and ending with 'SP'
                word_seq: list[str] — list of words from input
                ph_idx_to_word_idx: list[int] — maps each phoneme to word index
                    (-1 for SP boundaries)
        """
        # Split by whitespace and filter empties
        words = [w for w in input_text.split() if w]

        if not words:
            return (['SP'], [], [-1])

        ph_seq: list[str] = ['SP']
        ph_idx_to_word_idx: list[int] = [-1]
        word_seq: list[str] = []

        for word_idx, word in enumerate(words):
            word_seq.append(word)

            for char in word:
                if self._is_hangul(char):
                    phonemes = self._syllable_to_phonemes(char)
                    ph_seq.extend(phonemes)
                    ph_idx_to_word_idx.extend([word_idx] * len(phonemes))
                # Non-Hangul characters (English, numbers, punctuation) are skipped

            # Add SP separator after each word
            ph_seq.append('SP')
            ph_idx_to_word_idx.append(-1)

        # Ensure exactly one trailing SP (don't double up)
        while len(ph_seq) >= 2 and ph_seq[-1] == 'SP' and ph_seq[-2] == 'SP':
            _ = ph_seq.pop()
            _ = ph_idx_to_word_idx.pop()

        # Ensure the sequence ends with SP
        if ph_seq[-1] != 'SP':
            ph_seq.append('SP')
            ph_idx_to_word_idx.append(-1)

        # Clean up: ensure no more than 2 consecutive SP anywhere
        cleaned_ph: list[str] = []
        cleaned_idx: list[int] = []
        consecutive_sp = 0

        for ph, idx in zip(ph_seq, ph_idx_to_word_idx):
            if ph == 'SP':
                consecutive_sp += 1
                if consecutive_sp <= 2:
                    cleaned_ph.append(ph)
                    cleaned_idx.append(idx)
            else:
                consecutive_sp = 0
                cleaned_ph.append(ph)
                cleaned_idx.append(idx)

        return (cleaned_ph, word_seq, cleaned_idx)

    @staticmethod
    def _is_hangul(char: str) -> bool:
        """Check if a character is a Hangul syllable (가-힣)."""
        code = ord(char)
        return 0xAC00 <= code <= 0xD7A3

    @staticmethod
    def _decompose(char: str) -> tuple[int, int, int] | None:
        """Decompose a Hangul syllable into (onset_idx, nucleus_idx, coda_idx).

        Uses Unicode arithmetic:
            syllable_code = (onset * 21 + nucleus) * 28 + coda + 0xAC00

        Args:
            char: A single Hangul syllable character.

        Returns:
            Tuple of (onset_idx, nucleus_idx, coda_idx) or None if not Hangul.
        """
        code = ord(char) - 0xAC00
        if code < 0 or code > 11171:
            return None
        onset = code // (21 * 28)
        nucleus = (code % (21 * 28)) // 28
        coda = code % 28
        return (onset, nucleus, coda)

    def _syllable_to_phonemes(self, char: str) -> list[str]:
        """Convert a single Hangul syllable to a list of phonemes.

        Args:
            char: A single Hangul syllable character.

        Returns:
            List of phoneme strings for this syllable.
        """
        result = self._decompose(char)
        if result is None:
            return []

        onset_idx, nucleus_idx, coda_idx = result
        phonemes: list[str] = []

        # Onset — skip silent ㅇ (index 11, which maps to empty string)
        onset = self.ONSET_PHONEMES[onset_idx]
        if onset:
            phonemes.append(onset)

        # Nucleus — always present
        phonemes.append(self.NUCLEUS_PHONEMES[nucleus_idx])

        # Coda — skip if index 0 (no coda)
        if coda_idx > 0:
            coda = self.CODA_PHONEMES[coda_idx]
            if coda:
                phonemes.append(coda)

        return phonemes
