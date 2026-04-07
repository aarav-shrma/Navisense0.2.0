"""
NaviSense AI Service · Configuration
Reads from environment variables (set via .env → docker-compose).
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Inference device ───────────────────────────────────
    # "cuda" leverages RTX 3050; falls back to "cpu" automatically
    # if CUDA is unavailable (prevents hard crashes on dev machines).
    DEVICE: str = "cuda"

    # ── Model paths ────────────────────────────────────────
    YOLO_MODEL_PATH: str = "models/weights/yolov8n.pt"
    FACENET_MODEL_PATH: str = "models/weights/facenet.pt"
    TESSERACT_DATA_PATH: str = "/usr/share/tesseract-ocr/5/tessdata"

    # ── Detection thresholds ───────────────────────────────
    YOLO_CONFIDENCE_THRESHOLD: float = 0.45   # lower = more detections, higher latency
    FACE_SIMILARITY_THRESHOLD: float = 0.75   # cosine distance threshold for KNN match
    KNN_K: int = 3                            # neighbours to inspect in K-D Tree search

    # ── Latency budgets (ms) ───────────────────────────────
    # Hard deadlines for real-time assistive feedback.
    OBSTACLE_ALERT_BUDGET_MS: int = 150       # must alert user within 150 ms
    FACE_RECOGNITION_BUDGET_MS: int = 300

    # ── Feature flags ─────────────────────────────────────
    ENABLE_GPU_ACCELERATION: bool = True
    LOG_LEVEL: str = "info"

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Singleton — imported across all routers."""
    return Settings()
