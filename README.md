<div align="center">

# 🔍 Crack Jad

### AI-Powered Structural Crack Detection & Evaluation Platform

[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://python.org/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-FF6F00?logo=pytorch&logoColor=white)](https://ultralytics.com/)
[![Autodesk APS](https://img.shields.io/badge/Autodesk-APS%20%2F%20Forge-0696D7?logo=autodesk&logoColor=white)](https://aps.autodesk.com/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

**Upload a BIM model or crack photo → AI detects cracks → get a full structural evaluation, repair cost estimate, and a REPAIR / MONITOR / DEMOLISH verdict.**

<!-- Replace with your actual demo video link -->
[▶ Watch Demo](#) · [🏗 Architecture](#architecture) · [🚀 Quick Start](#quick-start) · [✨ Features](#features)

</div>

---

## Overview

Crack Jad is a Dockerized full-stack platform built for structural engineers and building inspectors. It combines **Autodesk Platform Services (APS)** for in-browser BIM/CAD viewing with a **YOLOv8 segmentation model** for automated crack detection, and wraps everything in a structured engineering evaluation engine aligned with ACI 224R, Eurocode 2, and ICOLD dam safety standards.

Built in 48 hours as a hackathon project.

---

## Features

### 🤖 AI Crack Detection
- YOLOv8 Large segmentation model (OpenSistemas, HuggingFace) — returns bounding boxes **and** polygon masks
- Scan directly from the 3D viewer viewport or upload a photo
- Confidence threshold slider (auto-capped at 0.15 for rendered views to handle domain shift vs. real photos)
- Canvas contrast enhancement (`contrast(160%) brightness(95%)`) applied before inference on viewer screenshots

### 🏗 Autodesk BIM Viewer
- Upload **70+ CAD/BIM formats**: Revit (`.rvt`), IFC, DWG, GLB, OBJ, STEP, FBX, and more
- APS Model Derivative API translates files to SVF2 for web rendering
- Autodesk Forge Viewer v7 with full orbit, pan, zoom, and sectioning
- Crack overlays rendered directly on the 3D model using DOM div layering (no extension lifecycle issues)

### 📐 Real-World Measurement
- Auto-calibrates mm/px scale from `viewer.model.getUnitScale()` — no manual calibration needed for CAD files
- Two-point depth measurement via `viewer.impl.hitTest()` raycasting against actual 3D geometry
- Debounced camera change listener keeps the scale accurate as you zoom/orbit

### 📋 Structural Evaluation Engine
- Classify each crack: structural location, material, crack type (shear, flexural, shrinkage, corrosion, ASR, etc.)
- Input dimensions (width, depth, length in mm) — depth auto-filled from model measurement
- Computes **repair volume**: `L × W × D × 1.25` (25% overhead for process waste)
- Auto-suggests repair method (epoxy injection, CFRP wrap, routing & sealing, grouting, etc.)
- Calculates estimated cost based on configurable unit rates
- Issues verdict: **REPAIR** / **MONITOR** / **DEMOLISH** with engineering justification

### ✏️ Manual Draw Mode
- Draw bounding boxes by hand when AI confidence is low
- Classify manually drawn detections (crack type, estimated width)
- Feeds into the same evaluation pipeline as AI detections

### ⚠️ Danger Reference Guide
- Severity thresholds table (ACI 224R-01, Eurocode 2, BS 8110)
- 8 crack type profile cards with risk levels
- Reservoir & dam-specific risk tables (ICOLD, USBR, FERC)
- Piping / internal erosion warning signs

### 📊 30-Day Inspection Log
- Every detection automatically logged to `localStorage`
- Filterable by model — global log or per-model view
- Summary stats: total scans, total defects, days active

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│                                                         │
│  ┌──────────────────┐       ┌────────────────────────┐  │
│  │   server          │       │   ml-service            │  │
│  │   Node.js/Express │──────▶│   Python / FastAPI      │  │
│  │   Port 3000       │ HTTP  │   Port 8000             │  │
│  │                   │       │                         │  │
│  │  • Static frontend│       │  • YOLOv8 inference     │  │
│  │  • APS proxy APIs │       │  • /predict endpoint    │  │
│  │  • File upload    │       │  • /health endpoint     │  │
│  └────────┬──────────┘       └────────────────────────┘  │
│           │                              ▲               │
│           │                    ./models:/app/models       │
│           │                    (volume mount)             │
└───────────┼──────────────────────────────────────────────┘
            │
     ┌──────▼──────┐         ┌──────────────────────┐
     │   Browser    │────────▶│  Autodesk Cloud (APS) │
     │  APS Viewer  │◀────────│  Model Derivative     │
     │  + Crack UI  │  CDN    │  Object Storage (OSS) │
     └─────────────┘         └──────────────────────┘
```

**Key design decisions:**
- `ml-service` depends on `server` via `condition: service_healthy` — the web server won't start until YOLOv8 is loaded
- Two APS token tiers: public `ViewablesRead` token for the browser, full-scope internal token for server operations only
- `./models` is volume-mounted — swap ML models without rebuilding containers

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML5 Canvas, Autodesk Forge Viewer v7 |
| Backend | Node.js 20, Express 4, Multer |
| ML Service | Python 3.11, FastAPI, Uvicorn, Ultralytics YOLOv8 |
| BIM/CAD | Autodesk Platform Services (APS) — OSS + Model Derivative |
| Containers | Docker Compose (2-service, bridge network, health checks) |
| ML Model | YOLOv8 Large (`crack-yolov8l.pt`) — OpenSistemas / HuggingFace |

---

## Quick Start

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Autodesk APS credentials ([get free credentials here](https://aps.autodesk.com/))
- YOLOv8 model weights (see below)

### 1. Clone the repo
```bash
git clone https://github.com/yourusername/crack-jad.git
cd crack-jad
```

### 2. Set up environment variables
```bash
cp .env.example .env
```
Edit `.env` with your credentials:
```env
APS_CLIENT_ID=your_client_id
APS_CLIENT_SECRET=your_client_secret
APS_BUCKET=crack-inspector-bucket
PORT=3000
ML_SERVICE_URL=http://ml-service:8000
```

### 3. Download the ML model
```bash
mkdir -p models
curl -L "https://huggingface.co/OpenSistemas/YOLOv8-crack-seg/resolve/main/yolov8l/weights/best.pt" \
  -o models/crack-yolov8l.pt
```

### 4. Run
```bash
docker compose up --build
```

Open **http://localhost:3000**

> The ML service takes ~30-60 seconds to load the model weights on first start. The server waits automatically via Docker health checks.

---

## Usage

1. **Upload a model** — drag in a `.glb`, `.rvt`, `.ifc`, or any supported CAD format
2. **Wait for translation** — Jad will keep you company with crack jokes while APS translates your model
3. **Run AI scan** — click **Scan Current View** or upload a crack photo
4. **Evaluate** — click any detection to open the full evaluation form
5. **Get verdict** — hit **Calculate & Assess** for REPAIR / MONITOR / DEMOLISH + cost estimate
6. **Reference** — check **Crack Danger Reference** for ACI/ICOLD thresholds and reservoir guidance

---

## Project Structure

```
crack-jad/
├── docker-compose.yml          # Two-service orchestration
├── .env.example                # Environment variable template
│
├── server/                     # Node.js/Express backend + frontend
│   ├── Dockerfile
│   ├── server.js               # Express entry point
│   ├── routes/
│   │   ├── auth.js             # APS 2-legged OAuth, dual-token strategy
│   │   ├── models.js           # APS OSS upload + Model Derivative translation
│   │   └── inspect.js          # ML inference proxy
│   └── public/
│       ├── index.html          # Single-page app
│       ├── viewer.js           # APS viewer, detection, evaluation engine
│       └── style.css           # Dark theme UI
│
├── ml-service/                 # Python FastAPI inference service
│   ├── Dockerfile
│   ├── app.py                  # YOLOv8 inference endpoints
│   └── requirements.txt
│
└── models/                     # ML model weights (not committed)
    └── crack-yolov8l.pt
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `APS_CLIENT_ID` | Autodesk Platform Services client ID | — |
| `APS_CLIENT_SECRET` | Autodesk Platform Services client secret | — |
| `APS_BUCKET` | OSS bucket name for uploaded models | `crack-inspector-bucket` |
| `PORT` | Server port | `3000` |
| `ML_SERVICE_URL` | Internal URL for the ML microservice | `http://ml-service:8000` |
| `MODEL_PATH` | Path to YOLOv8 weights inside the container | `/app/models/crack-yolov8l.pt` |

---

## Security Notes

- **APS credentials never reach the browser** — all APS SDK calls are server-side
- **Two token scopes**: browser gets `ViewablesRead` only; server uses full `DataRead/Write/Create`
- **Origin check** on `/api/auth/token` blocks external token harvesting
- **`.env` is gitignored** — use `.env.example` as the template

---

## Acknowledgements

- [OpenSistemas/YOLOv8-crack-seg](https://huggingface.co/OpenSistemas/YOLOv8-crack-seg) — pre-trained crack segmentation model
- [Autodesk Platform Services](https://aps.autodesk.com/) — BIM viewer and model translation
- [Ultralytics YOLOv8](https://ultralytics.com/) — object detection framework
- ACI 224R-01, Eurocode 2, ICOLD — engineering standards referenced in the evaluation engine

---

<div align="center">
Built with too much coffee and not enough sleep at a hackathon ☕<br>
<sub>Jad approves this message.</sub>
</div>
