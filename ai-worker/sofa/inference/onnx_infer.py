"""SOFA ONNX inference engine for forced phoneme alignment.

Ported from https://github.com/qiuqiao/SOFA (onnx_infer.py).

The ONNX model takes raw waveform input (MelSpectrogram is baked into the
model graph) and outputs frame-level phoneme log-probabilities and edge
(transition) probabilities. A numba-optimized Viterbi decoder then finds
the optimal forced alignment.

Key defaults (matching SOFA):
    - Sample rate: 44100 Hz
    - Hop length: 512 samples (~11.6ms per frame)
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    import onnxruntime as ort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Numba-optimized Viterbi forward pass (lazy-compiled on first call)
# ---------------------------------------------------------------------------

_forward_pass_compiled = None


def _get_forward_pass():
    """Lazy-compile the numba-optimized Viterbi forward pass.

    The function is compiled on first invocation to avoid importing numba
    at module load time (it may not be installed in all environments).
    """
    global _forward_pass_compiled
    if _forward_pass_compiled is not None:
        return _forward_pass_compiled

    import numba  # noqa: F811

    @numba.njit
    def forward_pass(
        T: int,
        S: int,
        prob_log: np.ndarray,
        not_edge_prob_log: np.ndarray,
        edge_prob_log: np.ndarray,
        curr_ph_max_prob_log: np.ndarray,
        dp: np.ndarray,
        backtrack_s: np.ndarray,
        ph_seq_id: np.ndarray,
        prob3_pad_len: int,
    ):
        """Dynamic-programming forward pass for Viterbi alignment.

        Three transition types per frame *t* and phoneme state *s*:
            prob1: stay in same phoneme   [t-1, s]   -> [t, s]
            prob2: move to next phoneme   [t-1, s-1] -> [t, s]
            prob3: skip SP phoneme        [t-1, s-2] -> [t, s]

        All arguments are modified in-place and returned.
        """
        for t in range(1, T):
            # --- prob1: stay in same phoneme [t-1, s] -> [t, s] ---
            prob1 = dp[t - 1, :] + prob_log[t, :] + not_edge_prob_log[t]

            # --- prob2: transition to next phoneme [t-1, s-1] -> [t, s] ---
            prob2 = np.empty(S, dtype=np.float32)
            prob2[0] = -np.inf
            for i in range(1, S):
                prob2[i] = (
                    dp[t - 1, i - 1]
                    + prob_log[t, i - 1]
                    + edge_prob_log[t]
                    + curr_ph_max_prob_log[i - 1] * (T / S)
                )

            # --- prob3: skip SP phoneme [t-1, s-2] -> [t, s] ---
            prob3 = np.empty(S, dtype=np.float32)
            for i in range(prob3_pad_len):
                prob3[i] = -np.inf
            for i in range(prob3_pad_len, S):
                if (
                    i - prob3_pad_len + 1 < S - 1
                    and ph_seq_id[i - prob3_pad_len + 1] != 0
                ):
                    prob3[i] = -np.inf
                else:
                    prob3[i] = (
                        dp[t - 1, i - prob3_pad_len]
                        + prob_log[t, i - prob3_pad_len]
                        + edge_prob_log[t]
                        + curr_ph_max_prob_log[i - prob3_pad_len] * (T / S)
                    )

            # --- select best transition for each state ---
            stacked_probs = np.empty((3, S), dtype=np.float32)
            for i in range(S):
                stacked_probs[0, i] = prob1[i]
                stacked_probs[1, i] = prob2[i]
                stacked_probs[2, i] = prob3[i]

            for i in range(S):
                max_idx = 0
                max_val = stacked_probs[0, i]
                for j in range(1, 3):
                    if stacked_probs[j, i] > max_val:
                        max_val = stacked_probs[j, i]
                        max_idx = j
                dp[t, i] = max_val
                backtrack_s[t, i] = max_idx

            # --- update running max log-prob for current phoneme ---
            for i in range(S):
                if backtrack_s[t, i] == 0:
                    curr_ph_max_prob_log[i] = max(
                        curr_ph_max_prob_log[i], prob_log[t, i]
                    )
                elif backtrack_s[t, i] > 0:
                    curr_ph_max_prob_log[i] = prob_log[t, i]

            # --- reset SP phoneme max prob (SP = index 0) ---
            for i in range(S):
                if ph_seq_id[i] == 0:
                    curr_ph_max_prob_log[i] = 0

        return dp, backtrack_s, curr_ph_max_prob_log

    _forward_pass_compiled = forward_pass
    return _forward_pass_compiled


# ---------------------------------------------------------------------------
# Viterbi decode (forward + backward)
# ---------------------------------------------------------------------------


def _decode(
    ph_seq_id: np.ndarray,
    ph_prob_log: np.ndarray,
    edge_prob: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Viterbi decode to find optimal phoneme-to-frame alignment.

    Args:
        ph_seq_id: Phoneme sequence as integer indices, shape ``(S,)``.
        ph_prob_log: Log-probabilities per frame per vocab entry,
            shape ``(T, vocab_size)``.
        edge_prob: Phoneme-edge probability per frame, shape ``(T,)``.

    Returns:
        Tuple of:
            - ``ph_idx_seq``: Indices into *ph_seq_id* for each aligned
              segment, shape ``(N,)``.
            - ``ph_time_int``: Frame index where each segment begins,
              shape ``(N,)``.
            - ``frame_confidence``: Per-frame confidence scores,
              shape ``(T,)``.
    """
    T = ph_prob_log.shape[0]
    S = len(ph_seq_id)

    # Extract log-probs only for phonemes in the target sequence → (T, S)
    prob_log = ph_prob_log[:, ph_seq_id]

    edge_prob_log = np.log(edge_prob + 1e-6).astype(np.float32)
    not_edge_prob_log = np.log(1 - edge_prob + 1e-6).astype(np.float32)

    # --- Initialise DP tables ---
    curr_ph_max_prob_log = np.full(S, -np.inf)
    dp = np.full((T, S), -np.inf, dtype=np.float32)
    backtrack_s = np.full_like(dp, -1, dtype=np.int32)

    dp[0, 0] = prob_log[0, 0]
    curr_ph_max_prob_log[0] = prob_log[0, 0]
    # If the first phoneme is SP and there is a second phoneme, also init it
    if ph_seq_id[0] == 0 and prob_log.shape[-1] > 1:
        dp[0, 1] = prob_log[0, 1]
        curr_ph_max_prob_log[1] = prob_log[0, 1]

    # --- Forward pass (numba-optimized) ---
    prob3_pad_len = 2 if S >= 2 else 1
    forward_pass = _get_forward_pass()
    dp, backtrack_s, curr_ph_max_prob_log = forward_pass(
        T,
        S,
        prob_log,
        not_edge_prob_log,
        edge_prob_log,
        curr_ph_max_prob_log,
        dp,
        backtrack_s,
        ph_seq_id,
        prob3_pad_len,
    )

    # --- Backward pass ---
    ph_idx_seq: list[int] = []
    ph_time_int: list[int] = []
    frame_confidence: list[float] = []

    # Forced mode: can only end on last phoneme, or second-to-last if last is SP
    if S >= 2 and dp[-1, -2] > dp[-1, -1] and ph_seq_id[-1] == 0:
        s = S - 2
    else:
        s = S - 1

    for t in range(T - 1, -1, -1):
        assert backtrack_s[t, s] >= 0 or t == 0
        frame_confidence.append(float(dp[t, s]))
        if backtrack_s[t, s] != 0:
            ph_idx_seq.append(s)
            ph_time_int.append(t)
            s -= int(backtrack_s[t, s])

    ph_idx_seq.reverse()
    ph_time_int.reverse()
    frame_confidence.reverse()

    # Convert cumulative log-probs to per-frame confidence
    frame_confidence_arr = np.exp(
        np.diff(
            np.pad(frame_confidence, (1, 0), "constant", constant_values=0.0),
            1,
        )
    )

    return (
        np.array(ph_idx_seq),
        np.array(ph_time_int),
        frame_confidence_arr,
    )


# ---------------------------------------------------------------------------
# SOFAOnnxInfer class
# ---------------------------------------------------------------------------


class SOFAOnnxInfer:
    """SOFA forced alignment using ONNX Runtime inference.

    The ONNX model takes raw waveform input (MelSpectrogram computation is
    baked into the model graph) and outputs:

    * ``ph_prob_log``  – frame-level phoneme log-probabilities ``(T, V)``
    * ``edge_prob``    – phoneme-boundary probability per frame ``(T,)``
    * ``edge_diff``    – sub-frame boundary refinement ``(T,)``
    * ``T``            – actual number of output frames (scalar)

    A Viterbi decoder then finds the optimal alignment of the given phoneme
    sequence to the audio frames.

    Example::

        infer = SOFAOnnxInfer("model.onnx", device="cpu")
        segments = infer.infer(waveform, ["SP", "h", "a", "SP"], vocab)
        for phoneme, start, end in segments:
            print(f"{phoneme}: {start:.3f}s – {end:.3f}s")
        infer.release()
    """

    def __init__(
        self,
        model_path: str,
        device: str = "cuda",
        sample_rate: int = 44100,
        hop_length: int = 512,
        scale_factor: float = 1.0,
    ) -> None:
        self._model_path = model_path
        self._device = device
        self._sample_rate = sample_rate
        self._hop_length = hop_length
        self._scale_factor = scale_factor
        self._session: ort.InferenceSession | None = None

    # ------------------------------------------------------------------
    # ONNX session management
    # ------------------------------------------------------------------

    def _get_session(self) -> ort.InferenceSession:
        """Lazy-load the ONNX Runtime inference session."""
        if self._session is not None:
            return self._session

        import onnxruntime as ort  # noqa: F811

        if self._device == "cuda":
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        else:
            providers = ["CPUExecutionProvider"]

        session_options = ort.SessionOptions()
        session_options.graph_optimization_level = (
            ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        )
        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

        self._session = ort.InferenceSession(
            self._model_path,
            sess_options=session_options,
            providers=providers,
        )
        logger.info(
            "Loaded ONNX model from %s (providers: %s)",
            self._model_path,
            providers,
        )
        return self._session

    def _run_model(
        self,
        waveform: np.ndarray,
        num_frames: int,
        ph_seq_id: np.ndarray,
    ) -> dict[str, np.ndarray]:
        """Run the ONNX model and return output tensors as a dict.

        Args:
            waveform: Mono audio, shape ``(samples,)``, float32.
            num_frames: Expected number of output spectrogram frames.
            ph_seq_id: Phoneme indices, shape ``(S,)``, int64.

        Returns:
            Dict with model output names as keys
            (``ph_prob_log``, ``edge_prob``, ``edge_diff``, ``T``, …).
        """
        session = self._get_session()
        output_names = [o.name for o in session.get_outputs()]

        # Model expects batched inputs: waveform [1, samples], ph_seq_id [1, S]
        input_data = {
            "waveform": [waveform.astype(np.float32)],
            "num_frames": np.array(num_frames, dtype=np.int64),
            "ph_seq_id": [ph_seq_id],
        }

        results = session.run(output_names, input_data)
        return dict(zip(output_names, results))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def infer(
        self,
        waveform: np.ndarray,
        ph_seq: list[str],
        ph_to_idx: dict[str, int],
    ) -> list[tuple[str, float, float]]:
        """Run forced alignment on audio with a given phoneme sequence.

        Args:
            waveform: Audio as numpy **float32** array (mono, sampled at
                ``self._sample_rate`` Hz).
            ph_seq: Ordered phoneme sequence, e.g.
                ``['SP', 'g', 'a', 'NG', 'SP']``.
            ph_to_idx: Mapping from phoneme string to the integer index
                used by the ONNX model's vocabulary.

        Returns:
            List of ``(phoneme, start_time_sec, end_time_sec)`` tuples
            representing the aligned segments. SP (silence) phonemes may
            be included; callers can filter them if desired.
        """
        # 1. Convert phoneme strings → integer indices
        ph_seq_id = np.array(
            [ph_to_idx[ph] for ph in ph_seq], dtype=np.int64
        )

        # 2. Compute expected number of output frames
        wav_length = waveform.shape[0] / self._sample_rate
        num_frames = int(
            (wav_length * self._scale_factor * self._sample_rate + 0.5)
            / self._hop_length
        )

        # 3. Run ONNX model
        outputs = self._run_model(waveform, num_frames, ph_seq_id)

        ph_prob_log = outputs["ph_prob_log"]
        edge_prob = outputs["edge_prob"]
        edge_diff = outputs["edge_diff"]
        total_frames = outputs["T"]

        # 4. Viterbi decode → optimal alignment
        ph_idx_seq, ph_time_int_pred, _frame_confidence = _decode(
            ph_seq_id, ph_prob_log, edge_prob
        )

        # 5. Convert frame indices → timestamps (with sub-frame refinement)
        frame_length = self._hop_length / (
            self._sample_rate * self._scale_factor
        )
        ph_time_fractional = (edge_diff[ph_time_int_pred] / 2).clip(-0.5, 0.5)
        ph_time_pred = frame_length * np.concatenate(
            [
                ph_time_int_pred.astype(np.float32) + ph_time_fractional,
                [float(total_frames)],
            ]
        )

        # 6. Build result list: (phoneme, start_sec, end_sec)
        result: list[tuple[str, float, float]] = []
        for j, ph_idx in enumerate(ph_idx_seq):
            start = max(0.0, float(ph_time_pred[j]))
            end = max(0.0, float(ph_time_pred[j + 1]))
            result.append((ph_seq[ph_idx], start, end))

        return result

    def release(self) -> None:
        """Release the ONNX Runtime session and free resources."""
        if self._session is not None:
            del self._session
            self._session = None
            logger.info("Released ONNX session")

    def __del__(self) -> None:
        """Ensure session is released on garbage collection."""
        self.release()
