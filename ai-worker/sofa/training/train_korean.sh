#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# SOFA Korean Model Training Script
# ============================================================
# Run this on a GPU server (e.g., AWS g6.xlarge with L4 GPU)
# Prerequisites: NVIDIA drivers, conda, git
#
# Usage:
#   bash train_korean.sh [--skip-setup] [--skip-data] [--steps N]
#
# Estimated time: 4-8 hours on L4 GPU (24GB VRAM)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_WORKER_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="${WORK_DIR:-/tmp/sofa-training}"
SOFA_REPO="${WORK_DIR}/SOFA"
CONDA_ENV="sofa"
TOTAL_STEPS=50000

# Parse arguments
SKIP_SETUP=false
SKIP_DATA=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-setup) SKIP_SETUP=true; shift ;;
        --skip-data) SKIP_DATA=true; shift ;;
        --steps) TOTAL_STEPS="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "============================================"
echo "SOFA Korean Training Pipeline"
echo "============================================"
echo "Work directory: $WORK_DIR"
echo "AI Worker dir:  $AI_WORKER_DIR"
echo "Total steps:    $TOTAL_STEPS"
echo "============================================"

# ----------------------------------------------------------
# Step 1: Clone SOFA repository
# ----------------------------------------------------------
if [ ! -d "$SOFA_REPO" ]; then
    echo "[Step 1] Cloning SOFA repository..."
    mkdir -p "$WORK_DIR"
    git clone https://github.com/qiuqiao/SOFA.git "$SOFA_REPO"
else
    echo "[Step 1] SOFA repo already exists, pulling latest..."
    git -C "$SOFA_REPO" pull
fi

# ----------------------------------------------------------
# Step 2: Create/activate conda environment
# ----------------------------------------------------------
if [ "$SKIP_SETUP" = false ]; then
    echo "[Step 2] Setting up conda environment..."
    if ! conda env list | grep -q "^${CONDA_ENV} "; then
        conda create -n "$CONDA_ENV" python=3.10 -y
    fi
    eval "$(conda shell.bash hook)"
    conda activate "$CONDA_ENV"

    echo "[Step 2b] Installing SOFA dependencies..."
    pip install -r "$SOFA_REPO/requirements.txt"
    pip install onnx onnxruntime  # For ONNX export
else
    echo "[Step 2] Skipping setup, activating existing env..."
    eval "$(conda shell.bash hook)"
    conda activate "$CONDA_ENV"
fi

# ----------------------------------------------------------
# Step 3: Download Japanese pretrained model (transfer learning)
# ----------------------------------------------------------
PRETRAINED_DIR="${WORK_DIR}/pretrained"
PRETRAINED_MODEL="${PRETRAINED_DIR}/akm_ja_v0.0.1.ckpt"
if [ ! -f "$PRETRAINED_MODEL" ]; then
    echo "[Step 3] Downloading Japanese pretrained model..."
    mkdir -p "$PRETRAINED_DIR"
    # From https://github.com/ariikamusic/SOFA_Models/releases/tag/akm_ja_v001
    wget -O "${PRETRAINED_DIR}/akm_ja_v0.0.1.zip" \
        "https://github.com/ariikamusic/SOFA_Models/releases/download/akm_ja_v001/akm_ja_v0.0.1.zip"
    cd "$PRETRAINED_DIR" && unzip -o akm_ja_v0.0.1.zip
    echo "[Step 3] Pretrained model ready: $PRETRAINED_MODEL"
else
    echo "[Step 3] Pretrained model already exists"
fi

# ----------------------------------------------------------
# Step 4: Copy Korean G2P and dictionary into SOFA
# ----------------------------------------------------------
echo "[Step 4] Installing Korean G2P module..."
cp "$AI_WORKER_DIR/sofa/g2p/korean_g2p.py" "$SOFA_REPO/modules/g2p/"
cp "$AI_WORKER_DIR/sofa/dictionary/korean.txt" "$SOFA_REPO/dictionary/"

# ----------------------------------------------------------
# Step 5: Prepare CSD training data
# ----------------------------------------------------------
if [ "$SKIP_DATA" = false ]; then
    echo "[Step 5] Preparing CSD training data..."
    cd "$SOFA_REPO"
    python "$AI_WORKER_DIR/sofa/training/prepare_csd.py" \
        --download \
        --output-dir "$SOFA_REPO/data"
else
    echo "[Step 5] Skipping data preparation"
fi

# ----------------------------------------------------------
# Step 6: Binarize training data
# ----------------------------------------------------------
echo "[Step 6] Binarizing training data..."
cd "$SOFA_REPO"
python binarize.py

# ----------------------------------------------------------
# Step 7: Train with transfer learning
# ----------------------------------------------------------
echo "[Step 7] Starting training (transfer learning from Japanese model)..."
echo "  Steps:    $TOTAL_STEPS"
echo "  Config:   $AI_WORKER_DIR/sofa/training/train_config.yaml"
echo "  Pretrain: $PRETRAINED_MODEL"
echo "  This will take 4-8 hours on L4 GPU..."
cd "$SOFA_REPO"
python train.py \
    -p "$PRETRAINED_MODEL" \
    --config "$AI_WORKER_DIR/sofa/training/train_config.yaml"

# ----------------------------------------------------------
# Step 8: Find the best checkpoint
# ----------------------------------------------------------
echo "[Step 8] Finding best checkpoint..."
BEST_CKPT=$(find "$SOFA_REPO/ckpt/" -name '*.ckpt' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | awk '{print $2}')
if [ -z "${BEST_CKPT:-}" ]; then
    echo "ERROR: No checkpoint found in $SOFA_REPO/ckpt/"
    exit 1
fi
echo "  Best checkpoint: $BEST_CKPT"

# ----------------------------------------------------------
# Step 9: Export to ONNX
# ----------------------------------------------------------
echo "[Step 9] Exporting to ONNX..."
cd "$SOFA_REPO"
python export_onnx.py --ckpt "$BEST_CKPT"

# ----------------------------------------------------------
# Step 10: Copy ONNX model to ai-worker
# ----------------------------------------------------------
ONNX_MODEL=$(find "$SOFA_REPO" -maxdepth 1 -name '*.onnx' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | awk '{print $2}')
if [ -z "${ONNX_MODEL:-}" ]; then
    echo "ERROR: No ONNX model found in $SOFA_REPO/"
    exit 1
fi

echo "[Step 10] Copying ONNX model to ai-worker..."
mkdir -p "$AI_WORKER_DIR/sofa/models"
cp "$ONNX_MODEL" "$AI_WORKER_DIR/sofa/models/sofa_korean.onnx"

echo "============================================"
echo "Training complete!"
echo "ONNX model: $AI_WORKER_DIR/sofa/models/sofa_korean.onnx"
echo "============================================"
echo ""
echo "To deploy: Copy the ONNX model to the GPU server and restart ai-worker"
