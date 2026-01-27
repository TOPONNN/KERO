FROM python:3.11-slim-bullseye

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

# Install system dependencies including FFmpeg 6+ from backports
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    gnupg \
    git \
    xz-utils \
    libsndfile1 \
    libgomp1 \
    wget \
    bzip2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Miniforge (conda-forge only, no Anaconda ToS issues)
ENV CONDA_DIR=/opt/conda
RUN wget -q https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh -O /tmp/miniforge.sh && \
    bash /tmp/miniforge.sh -b -p $CONDA_DIR && \
    rm /tmp/miniforge.sh
ENV PATH="${CONDA_DIR}/bin:${PATH}"

# Install MFA in separate environment with Python 3.11
RUN conda create -n mfa python=3.11 montreal-forced-aligner -y && \
    conda clean -afy
ENV PATH="${CONDA_DIR}/envs/mfa/bin:${PATH}"

# Install Korean/Japanese tokenizer support for MFA
RUN pip install python-mecab-ko jamo fugashi unidic-lite

# Download MFA acoustic models and dictionaries
RUN mfa model download acoustic english_us_arpa && \
    mfa model download dictionary english_us_arpa && \
    mfa model download acoustic korean_mfa && \
    mfa model download dictionary korean_mfa && \
    mfa model download acoustic japanese_mfa && \
    mfa model download dictionary japanese_mfa

# Install FFmpeg 6 (static build for av compatibility)
RUN curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar -xJ && \
    mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    rm -rf ffmpeg-*-amd64-static

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Install Deno
RUN curl -fsSL https://deno.land/install.sh | sh && \
    ln -s /root/.deno/bin/deno /usr/local/bin/deno
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

# Set up Python environment
ENV UV_PROJECT_ENVIRONMENT=/app/venv
ENV VIRTUAL_ENV=/app/venv
ENV UV_LINK_MODE=copy
ENV UV_PYTHON_DOWNLOADS=0
ENV UV_PYTHON=3.11

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN uv venv /app/venv && \
    uv pip install --no-cache -r requirements.txt

# Set environment for PyTorch bundled cuDNN
ENV PATH="/app/venv/bin:${PATH}"
ENV PYTHONPATH="/app/venv/lib/python3.11/site-packages"
ENV LD_LIBRARY_PATH="/app/venv/lib/python3.11/site-packages/nvidia/cudnn/lib:/app/venv/lib/python3.11/site-packages/nvidia/cublas/lib:/app/venv/lib/python3.11/site-packages/nvidia/cufft/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

COPY src/ ./src/

ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "src.worker"]
