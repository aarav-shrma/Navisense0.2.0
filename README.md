# NaviSense 🔵
### *"Empowering Independence Through Sight"*

An AI-powered accessibility tool for the visually impaired. NaviSense acts as an intelligent
visual companion — providing real-time obstacle detection, face recognition, text reading (OCR),
safe-crossing assistance, and a fully hands-free voice interface.

---

## Monorepo Structure

```
NaviSense/
├── ai-service/          # Python · FastAPI · TensorFlow/PyTorch AI microservice
├── api-gateway/         # Node.js · Express · Supabase gateway
├── mobile-app/          # React Native · Expo cross-platform mobile client
├── docs/                # Architecture diagrams & API contracts
├── scripts/             # DB migration & utility scripts
├── docker-compose.yml   # Local orchestration
└── .env.example         # Environment variable template
```

## Quick Start

### Prerequisites
- Docker & Docker Compose ≥ 2.x
- Node.js ≥ 20 LTS
- Python ≥ 3.11
- CUDA 12.x + cuDNN 8.x (for RTX 3050 local GPU inference)
- Expo CLI (`npm install -g expo-cli`)

### 1. Clone & configure environment
```bash
git clone https://github.com/aarav-shrma/NaviSense.git
cd NaviSense
cp .env.example .env
# Fill in your secrets in .env
```

### 2. Launch all services locally
```bash
docker-compose up --build
```

| Service       | URL                        |
|---------------|----------------------------|
| AI Service    | http://localhost:8000/docs  |
| API Gateway   | http://localhost:3001       |
| Supabase UI   | http://localhost:54323      |

### 3. Run the mobile app
```bash
cd mobile-app
npm install
npx expo start
```

---

## Architecture Overview

```
[Mobile App (React Native/Expo)]
        │  REST + WebSocket
        ▼
[API Gateway (Node/Express)]  ──── Supabase (Auth + Postgres)
        │  Internal HTTP
        ▼
[AI Microservice (FastAPI)]
   ├── /detect       → YOLO v8 Object Detection
   ├── /navigate     → A* Pathfinding on Graph
   ├── /recognize    → FaceNet + KD-Tree KNN
   ├── /ocr          → Tesseract OCR
   └── /voice        → STT → FSM → TTS pipeline
```

---

## Team
- **Aarav Sharma** — CSIT, Sem III, Roll No. 27421
