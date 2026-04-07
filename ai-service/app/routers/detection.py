"""
NaviSense · Module A: Intelligent Navigation & Object Detection
═══════════════════════════════════════════════════════════════
DSA used:
  • 3D Array / Tensor  — video frame representation [H][W][C]
  • List[BoundingBox]  — dynamic list of detected obstacles
  • YOLO v8 CNN        — real-time, single-pass object detection

Latency target: < 150 ms per frame on RTX 3050 (4 GB VRAM).
"""
import time
import io
from typing import Optional

import numpy as np
import torch
from fastapi import APIRouter, File, UploadFile, HTTPException, Depends
from PIL import Image
from pydantic import BaseModel, Field
from ultralytics import YOLO
from loguru import logger

from app.core.config import get_settings, Settings

router = APIRouter()

# ── Model Singleton ─────────────────────────────────────────
# Loaded once at module import; shared across all requests.
# ERROR HANDLING: wrap in try/except — if weights are missing,
# the service should start in degraded mode, not crash entirely.
_yolo_model: Optional[YOLO] = None


def get_yolo_model(settings: Settings = Depends(get_settings)) -> YOLO:
    global _yolo_model
    if _yolo_model is None:
        try:
            _yolo_model = YOLO(settings.YOLO_MODEL_PATH)
            device = "cuda" if torch.cuda.is_available() and settings.ENABLE_GPU_ACCELERATION else "cpu"
            _yolo_model.to(device)
            logger.info(f"YOLOv8 loaded on {device}")
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            raise HTTPException(status_code=503, detail="Detection model unavailable")
    return _yolo_model


# ── Pydantic Schemas ─────────────────────────────────────────

class BoundingBox(BaseModel):
    """
    Represents a single detected obstacle.
    Stored in a dynamic list (Python list ≡ ArrayList) after each inference pass.

    Coordinates are normalised [0.0–1.0] relative to frame dimensions
    to remain resolution-agnostic across devices.
    """
    class_label: str = Field(..., example="staircase")
    confidence_score: float = Field(..., ge=0.0, le=1.0, example=0.91)
    x: float = Field(..., description="Normalised x-centre of bounding box")
    y: float = Field(..., description="Normalised y-centre of bounding box")
    width: float = Field(..., description="Normalised width of bounding box")
    height: float = Field(..., description="Normalised height of bounding box")
    distance_hint: Optional[str] = Field(
        None,
        description="Heuristic proximity: 'near' | 'medium' | 'far' (based on box area)"
    )


class DetectionResponse(BaseModel):
    obstacles: list[BoundingBox]
    inference_ms: float
    frame_width: int
    frame_height: int


# ── Frame → Tensor Conversion ────────────────────────────────

def image_bytes_to_tensor(raw: bytes) -> tuple[np.ndarray, int, int]:
    """
    Decode image bytes → 3D NumPy array of shape [height][width][channels].
    This is the fundamental data structure for all CV operations (TensorFlow / PyTorch).

    Returns (array, height, width).

    ERROR HANDLING: Corrupt / empty uploads will raise ValueError here,
    caught by the endpoint and returned as HTTP 422.
    """
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        arr = np.array(img)          # shape: (H, W, 3) — 3D Array / Tensor
        return arr, arr.shape[0], arr.shape[1]
    except Exception as e:
        raise ValueError(f"Invalid image data: {e}")


def proximity_hint(norm_area: float) -> str:
    """
    Simple heuristic: larger bounding-box area → object is closer.
    Used to generate directional audio alerts ("near obstacle ahead").
    """
    if norm_area > 0.25:
        return "near"
    elif norm_area > 0.08:
        return "medium"
    return "far"


# ── Endpoint ─────────────────────────────────────────────────

@router.post("/frame", response_model=DetectionResponse, summary="Detect obstacles in a video frame")
async def detect_obstacles(
    frame: UploadFile = File(..., description="JPEG/PNG frame from device camera"),
    settings: Settings = Depends(get_settings),
    model: YOLO = Depends(get_yolo_model),
):
    """
    Accepts a single camera frame and returns a list of detected obstacles.

    Pipeline:
    1. Decode bytes → 3D Tensor [H][W][C]
    2. Run YOLOv8 CNN inference (single forward pass)
    3. Filter by confidence threshold
    4. Return sorted list of BoundingBox objects (closest first)

    LATENCY NOTE: Network upload is the dominant cost on mobile networks.
    Consider WebSocket streaming or gRPC for sub-100 ms round-trips in production.
    """
    raw = await frame.read()

    # ── Step 1: Decode frame into 3D tensor ────────────────
    try:
        img_array, h, w = image_bytes_to_tensor(raw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # ── Step 2: YOLO inference ─────────────────────────────
    t0 = time.perf_counter()
    try:
        results = model.predict(
            source=img_array,
            conf=settings.YOLO_CONFIDENCE_THRESHOLD,
            verbose=False,
            stream=False,       # single frame; use stream=True for video pipelines
        )
    except torch.cuda.OutOfMemoryError:
        # VRAM exhausted on RTX 3050 — flush cache and retry on CPU
        logger.warning("CUDA OOM — retrying on CPU")
        torch.cuda.empty_cache()
        results = model.predict(source=img_array, conf=settings.YOLO_CONFIDENCE_THRESHOLD, device="cpu")

    inference_ms = (time.perf_counter() - t0) * 1000

    if inference_ms > settings.OBSTACLE_ALERT_BUDGET_MS:
        logger.warning(f"Obstacle detection exceeded latency budget: {inference_ms:.1f} ms")

    # ── Step 3: Build List[BoundingBox] ───────────────────
    obstacles: list[BoundingBox] = []
    for result in results:
        for box in result.boxes:
            cx, cy, bw, bh = box.xywhn[0].tolist()   # normalised coords
            obstacles.append(BoundingBox(
                class_label=result.names[int(box.cls)],
                confidence_score=round(float(box.conf), 3),
                x=round(cx, 4),
                y=round(cy, 4),
                width=round(bw, 4),
                height=round(bh, 4),
                distance_hint=proximity_hint(bw * bh),
            ))

    # Sort: closest (largest area) first → most urgent audio alert first
    obstacles.sort(key=lambda b: b.width * b.height, reverse=True)

    return DetectionResponse(
        obstacles=obstacles,
        inference_ms=round(inference_ms, 2),
        frame_width=w,
        frame_height=h,
    )
