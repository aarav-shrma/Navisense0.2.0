"""
NaviSense AI Microservice · Entry Point
FastAPI application wiring all feature routers together.
"""
import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from prometheus_fastapi_instrumentator import Instrumentator

from app.core.config import get_settings
from app.routers import detection, recognition, voice, navigation

settings = get_settings()

# ── App init ────────────────────────────────────────────────
app = FastAPI(
    title="NaviSense AI Service",
    description="Real-time object detection, face recognition, OCR & voice for the visually impaired.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ────────────────────────────────────────────────────
# In production, restrict origins to the API Gateway's domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Prometheus metrics ──────────────────────────────────────
Instrumentator().instrument(app).expose(app)

# ── Routers ─────────────────────────────────────────────────
app.include_router(detection.router,   prefix="/detect",    tags=["Module A: Detection"])
app.include_router(navigation.router,  prefix="/navigate",  tags=["Module A: Navigation"])
app.include_router(recognition.router, prefix="/recognize", tags=["Module B: Recognition"])
app.include_router(voice.router,       prefix="/voice",     tags=["Module C: Voice"])


# ── Startup / Shutdown lifecycle ────────────────────────────
@app.on_event("startup")
async def startup_event():
    device = "cuda" if torch.cuda.is_available() and settings.ENABLE_GPU_ACCELERATION else "cpu"
    logger.info(f"NaviSense AI starting | device={device}")
    if device == "cuda":
        logger.info(f"GPU: {torch.cuda.get_device_name(0)} | VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("NaviSense AI shutting down — releasing GPU resources")
    torch.cuda.empty_cache()


@app.get("/health", tags=["Infra"])
async def health():
    return {
        "status": "ok",
        "cuda_available": torch.cuda.is_available(),
        "device": settings.DEVICE,
    }
