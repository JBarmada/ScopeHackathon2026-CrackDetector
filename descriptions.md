# Crack Jad

Crack Jad is a Dockerized web platform that combines Autodesk Platform Services (APS) BIM viewer integration with YOLOv8 AI crack segmentation, structural classification, CAD-based real-world measurement, and automated repair cost estimation aligned with ACI 224R and ICOLD dam safety guidance.

## Core Pipeline

AI detection → classification → repair volume calculation → cost estimate → REPAIR / MONITOR / DEMOLISH verdict

## Quick Run

```bash
docker compose build server && docker compose up -d server
```

## Resume-Level Description

### Full Stack / Software Engineering

- Architected and deployed a full-stack crack detection web app using a 2-service Docker Compose stack (Node.js/Express + Python/FastAPI), enabling zero-config deployment with a single `docker compose up`.
- Integrated Autodesk Platform Services (APS) to upload, translate, and render 70+ CAD/BIM formats (Revit, IFC, DWG, GLB) in-browser using Forge Viewer v7, with 2-legged OAuth and a dual-token security model.
- Built a real-time ML inference pipeline that proxies YOLOv8 segmentation results from a FastAPI microservice through an Express backend, returning bounding boxes, confidence scores, and polygon masks in under 1 second.
- Implemented health-gated startup via `depends_on: condition: service_healthy`, preventing the web server from accepting traffic until the ML model (~87 MB) is loaded.
- Designed a scope-separated APS token strategy with a public `ViewablesRead` browser token and a full-scope internal token for OSS/Model Derivative operations, plus origin validation to reduce token harvesting risk.

### AI / Machine Learning

- Deployed a YOLOv8 Large segmentation model (`crack-yolov8l.pt`) from Hugging Face (OpenSistemas) using Ultralytics, achieving sub-second crack detection with polygon mask output.
- Engineered a canvas preprocessing pipeline (`contrast(160%) brightness(95%)`) on APS Viewer WebGL screenshots before inference, improving detection performance on rendered 3D models versus real photos.
- Built a confidence-adaptive detection workflow that caps confidence at `0.15` for viewer scans (versus `0.25` for photos) to handle domain shift between rendered and photographic inputs.
- Implemented a manual draw fallback mode so engineers can annotate cracks when AI confidence is low, while still feeding manual detections into the same downstream evaluation pipeline.

### Structural Engineering / Domain

- Developed an evaluation engine that classifies cracks by location (beam, column, dam face, spillway), material (RC, masonry, steel), and crack type (shear, flexural, shrinkage, corrosion), then computes repair volume (`L × W × D × 1.25`) and estimated cost.
- Built a rules-based verdict system referencing ACI 224R-01, Eurocode 2, and ICOLD guidance to issue REPAIR / MONITOR / DEMOLISH outcomes using crack width, depth, activity status, and water proximity.
- Integrated APS Viewer `hitTest` raycasting to measure real-world crack depth directly from CAD geometry using `viewer.model.getUnitScale()` for automatic mm/px calibration.
- Created a danger reference guide with severity thresholds, 8 crack type profiles, reservoir/dam-specific risk tables, and key standards (ICOLD, USBR, FERC, BS EN 1992-3).

### Short 1-Liners (Skills / Highlights)

- Built and containerized a YOLOv8-powered structural crack detection app with Autodesk BIM viewer integration.
- Designed a full structural evaluation pipeline: AI detection → classification → repair volume calculation → cost estimate → REPAIR / MONITOR / DEMOLISH verdict.
- Delivered production-ready Docker architecture with health-gated startup, volume-mounted ML models, and isolated internal networking.