"""
NaviSense · Module B: Personalized Recognition Engine
══════════════════════════════════════════════════════
DSA used:
  • Hash Map (dict)    — O(1) average lookup: name → embedding metadata
  • K-D Tree           — scipy.spatial.KDTree for efficient nearest-neighbour search
  • KNN Algorithm      — find k most similar face embeddings in embedding space
  • OCR (Tesseract)    — extract text from image regions

FaceNet generates a 512-dimensional embedding vector per face.
Embeddings are stored in a KDTree for sub-millisecond KNN queries
even with thousands of enrolled users.
"""
import io
import time
from typing import Optional

import numpy as np
import pytesseract
import torch
from PIL import Image
from facenet_pytorch import InceptionResnetV1, MTCNN
from fastapi import APIRouter, File, Form, UploadFile, HTTPException, Depends
from pydantic import BaseModel
from scipy.spatial import KDTree
from loguru import logger

from app.core.config import get_settings, Settings

router = APIRouter()


# ══════════════════════════════════════════════════════════════
#  EMBEDDING STORE — Hash Map + K-D Tree
# ══════════════════════════════════════════════════════════════

class EmbeddingStore:
    """
    In-memory face database combining two complementary data structures:

    1. Hash Map (self._user_map):
       key   = user_name (str)
       value = {"embedding": np.ndarray, "enrolled_at": timestamp}
       → O(1) average-case lookup / insert / delete by name.

    2. K-D Tree (self._kd_tree):
       Organises all embedding vectors in 512-dimensional space.
       → O(log N) nearest-neighbour queries for face matching.
       Rebuilt whenever the store is mutated (enroll / delete).

    In production: persist embeddings to Supabase (vector column or JSONB).
    Hydrate this store at service startup from the DB.
    """

    def __init__(self):
        self._user_map: dict[str, dict] = {}   # Hash Map: name → metadata
        self._kd_tree: Optional[KDTree] = None
        self._index_to_name: list[str] = []    # positional index for KDTree results

    # ── Mutators ────────────────────────────────────────────

    def enroll(self, name: str, embedding: np.ndarray) -> None:
        """Register a new face embedding. Rebuilds the KD-Tree."""
        self._user_map[name] = {
            "embedding": embedding.astype(np.float32),
            "enrolled_at": time.time(),
        }
        self._rebuild_tree()
        logger.info(f"Enrolled user: {name} | store size: {len(self._user_map)}")

    def remove(self, name: str) -> bool:
        """Remove a user. Returns True if found and deleted."""
        if name in self._user_map:
            del self._user_map[name]
            self._rebuild_tree()
            return True
        return False

    def _rebuild_tree(self) -> None:
        """Rebuild K-D Tree from current Hash Map contents."""
        if not self._user_map:
            self._kd_tree = None
            self._index_to_name = []
            return
        self._index_to_name = list(self._user_map.keys())
        matrix = np.stack([self._user_map[n]["embedding"] for n in self._index_to_name])
        self._kd_tree = KDTree(matrix)

    # ── Query ───────────────────────────────────────────────

    def find_nearest(
        self,
        query_embedding: np.ndarray,
        k: int = 3,
        distance_threshold: float = 0.75,
    ) -> list[dict]:
        """
        KNN search via K-D Tree.

        Args:
            query_embedding: 512-dim vector from FaceNet.
            k:               Number of nearest neighbours to inspect.
            distance_threshold: Euclidean distance beyond which match is rejected
                                (prevents false positives for unknown faces).

        Returns:
            List of matches sorted by distance (closest first).
            Each match: {"name": str, "distance": float, "confidence": float}

        Time complexity: O(log N) average for KDTree query.
        """
        if self._kd_tree is None:
            return []

        k = min(k, len(self._index_to_name))
        distances, indices = self._kd_tree.query(
            query_embedding.reshape(1, -1), k=k, workers=-1  # multi-core query
        )

        matches = []
        for dist, idx in zip(distances[0], indices[0]):
            if dist <= distance_threshold:
                matches.append({
                    "name": self._index_to_name[idx],
                    "distance": round(float(dist), 4),
                    "confidence": round(1.0 - (dist / distance_threshold), 3),
                })
        return matches

    @property
    def enrolled_count(self) -> int:
        return len(self._user_map)


# ── Global store (singleton per service process) ─────────────
_store = EmbeddingStore()


# ══════════════════════════════════════════════════════════════
#  FACENET MODEL
# ══════════════════════════════════════════════════════════════

_mtcnn: Optional[MTCNN] = None
_facenet: Optional[InceptionResnetV1] = None


def get_facenet_models(settings: Settings = Depends(get_settings)):
    global _mtcnn, _facenet
    if _facenet is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        # MTCNN: face detection & alignment (returns 160×160 crops)
        _mtcnn = MTCNN(image_size=160, margin=20, device=device, keep_all=False)
        # InceptionResnetV1 pre-trained on VGGFace2 → 512-dim embedding
        _facenet = InceptionResnetV1(pretrained="vggface2").eval().to(device)
        logger.info(f"FaceNet loaded on {device}")
    return _mtcnn, _facenet


def compute_embedding(image: Image.Image, mtcnn: MTCNN, facenet: InceptionResnetV1) -> Optional[np.ndarray]:
    """
    Face detection → alignment → 512-dim FaceNet embedding.

    LATENCY NOTE: MTCNN adds ~20–40 ms per image. For real-time streaming,
    run detection every N frames and recognition only on detected regions.

    Returns None if no face is detected.
    """
    face_tensor = mtcnn(image)          # detects, crops, aligns → (1, 3, 160, 160)
    if face_tensor is None:
        return None
    with torch.no_grad():
        embedding = facenet(face_tensor.unsqueeze(0))  # (1, 512)
    return embedding.squeeze().cpu().numpy()


# ══════════════════════════════════════════════════════════════
#  API ENDPOINTS
# ══════════════════════════════════════════════════════════════

class EnrollResponse(BaseModel):
    success: bool
    message: str
    enrolled_count: int


class RecognitionMatch(BaseModel):
    name: str
    confidence: float
    distance: float


class RecognitionResponse(BaseModel):
    matches: list[RecognitionMatch]
    face_detected: bool
    inference_ms: float


class OCRResponse(BaseModel):
    text: str
    word_count: int
    inference_ms: float


@router.post("/enroll", response_model=EnrollResponse, summary="Enroll a new face into the recognition store")
async def enroll_face(
    name: str = Form(..., example="Priya Sharma"),
    image: UploadFile = File(..., description="Clear frontal face photo"),
    models=Depends(get_facenet_models),
):
    """
    Compute a FaceNet embedding for the provided image and store it.

    ERROR HANDLING: If face detection fails (blurry, obscured, or no face),
    return HTTP 422 to prompt the user to retake the photo.
    """
    mtcnn, facenet = models
    raw = await image.read()
    pil_img = Image.open(io.BytesIO(raw)).convert("RGB")

    embedding = compute_embedding(pil_img, mtcnn, facenet)
    if embedding is None:
        raise HTTPException(status_code=422, detail="No face detected in the provided image. Please retake.")

    _store.enroll(name, embedding)
    return EnrollResponse(
        success=True,
        message=f"'{name}' enrolled successfully.",
        enrolled_count=_store.enrolled_count,
    )


@router.post("/face", response_model=RecognitionResponse, summary="Identify faces in a camera frame")
async def recognize_face(
    frame: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    models=Depends(get_facenet_models),
):
    """
    Detect and identify faces in a live camera frame.

    Pipeline:
    1. MTCNN → detect & align face crop
    2. FaceNet → compute 512-dim embedding
    3. KDTree.query(embedding, k=K) → find nearest neighbours
    4. Return matches above confidence threshold
    """
    mtcnn, facenet = models
    raw = await frame.read()
    pil_img = Image.open(io.BytesIO(raw)).convert("RGB")

    t0 = time.perf_counter()
    embedding = compute_embedding(pil_img, mtcnn, facenet)
    if embedding is None:
        return RecognitionResponse(matches=[], face_detected=False, inference_ms=0.0)

    raw_matches = _store.find_nearest(
        embedding,
        k=settings.KNN_K,
        distance_threshold=settings.FACE_SIMILARITY_THRESHOLD,
    )
    inference_ms = (time.perf_counter() - t0) * 1000

    if inference_ms > settings.FACE_RECOGNITION_BUDGET_MS:
        logger.warning(f"Face recognition exceeded latency budget: {inference_ms:.1f} ms")

    return RecognitionResponse(
        matches=[RecognitionMatch(**m) for m in raw_matches],
        face_detected=True,
        inference_ms=round(inference_ms, 2),
    )


@router.post("/ocr", response_model=OCRResponse, summary="Extract text from an image region (OCR)")
async def read_text(frame: UploadFile = File(..., description="Image containing text (sign, menu, currency)")):
    """
    Optical Character Recognition using Tesseract.

    Use cases: reading street signs, restaurant menus, currency notes,
    product labels — common daily hurdles for visually impaired users.

    ERROR HANDLING: Tesseract may return empty strings for blurry or
    low-resolution inputs. The client should prompt a retake rather
    than reading an empty string to the user.
    """
    raw = await frame.read()
    pil_img = Image.open(io.BytesIO(raw)).convert("RGB")

    t0 = time.perf_counter()
    try:
        # PSM 6: assume a single uniform block of text
        text = pytesseract.image_to_string(pil_img, config="--psm 6").strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR engine error: {e}")
    inference_ms = (time.perf_counter() - t0) * 1000

    return OCRResponse(
        text=text or "No readable text detected.",
        word_count=len(text.split()),
        inference_ms=round(inference_ms, 2),
    )
