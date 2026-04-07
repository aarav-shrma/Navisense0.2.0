# ─── NaviSense AI Service Dockerfile ────────────────────────
# Base: CUDA 12.1 + cuDNN 8 (matches RTX 3050 VRAM constraints)
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# System dependencies (Tesseract OCR engine + audio libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip \
    tesseract-ocr tesseract-ocr-eng \
    libsndfile1 ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps — split to leverage Docker layer caching
COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121 \
 && pip install -r requirements.txt

COPY . .

EXPOSE 8000

# --workers 1: single worker keeps GPU memory predictable on 4 GB VRAM
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
