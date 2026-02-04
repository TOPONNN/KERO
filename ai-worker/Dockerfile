FROM python:3.12-slim-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

# Install system dependencies including FFmpeg 6+ from backports
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    git \
    xz-utils \
    libsndfile1 \
    libgomp1 \
    ca-certificates \
    gcc \
    g++ \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Install FFmpeg 6 (static build for av compatibility)
RUN curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar -xJ && \
    mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    rm -rf ffmpeg-*-amd64-static

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Install Deno (to shared location accessible by non-root user)
ENV DENO_INSTALL="/opt/deno"
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/opt/deno sh && \
    chmod -R a+rx /opt/deno && \
    ln -sf /opt/deno/bin/deno /usr/local/bin/deno
ENV PATH="/opt/deno/bin:${PATH}"

# Set up Python environment
ENV UV_PROJECT_ENVIRONMENT=/app/venv
ENV VIRTUAL_ENV=/app/venv
ENV UV_LINK_MODE=copy
ENV UV_PYTHON_DOWNLOADS=0
ENV UV_PYTHON=3.12

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN uv venv /app/venv && \
    uv pip install --no-cache --index-strategy unsafe-best-match -r requirements.txt

# Set environment for PyTorch bundled cuDNN
ENV PATH="/app/venv/bin:${PATH}"
ENV PYTHONPATH="/app/venv/lib/python3.12/site-packages"
ENV LD_LIBRARY_PATH="/app/venv/lib/python3.12/site-packages/nvidia/cudnn/lib:/app/venv/lib/python3.12/site-packages/nvidia/cublas/lib:/app/venv/lib/python3.12/site-packages/nvidia/cufft/lib:/app/venv/lib/python3.12/site-packages/nvidia/curand/lib:/app/venv/lib/python3.12/site-packages/nvidia/cusolver/lib:/app/venv/lib/python3.12/site-packages/nvidia/cusparse/lib:/app/venv/lib/python3.12/site-packages/nvidia/cuda_runtime/lib:/app/venv/lib/python3.12/site-packages/nvidia/cuda_cupti/lib:/app/venv/lib/python3.12/site-packages/nvidia/cuda_nvrtc/lib:/app/venv/lib/python3.12/site-packages/nvidia/nvjitlink/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

# Pre-download MelBand Roformer model so it's baked into the image
RUN python -c "from audio_separator.separator import Separator; s = Separator(); s.load_model('mel_band_roformer_kim_ft3_unwa.ckpt')"

COPY src/ ./src/
COPY sofa/ ./sofa/

# Create non-root user with writable home directory
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup --create-home --home-dir /home/appuser appuser && \
    chown -R appuser:appgroup /app
ENV HOME=/home/appuser

USER appuser

ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "src.worker"]
