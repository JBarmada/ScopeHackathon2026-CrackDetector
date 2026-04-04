Welcome to the **Autodesk Crack Inspector** project! This guide will help you understand the architecture, get your local environment running, and orient you within the codebase. 

---

### 🏗️ Project Overview
This is a full-stack, Dockerized application that uses Machine Learning (YOLO) to detect cracks and defects in photos, and then overlays those detections onto 2D drawings or 3D models using Autodesk Platform Services (APS). 

### 🛠️ Tech Stack
* **Architecture:** Multi-container Docker application (`docker-compose.yml`).
* **Web Server / Backend:** Node.js v20. Uses Express and the APS SDK to handle 3D model translations and serve the frontend UI.
* **ML Service:** Python 3.11. A FastAPI application running an Ultralytics YOLOv8 segmentation model.
* **Frontend:** Vanilla HTML/CSS/JS integrating the Autodesk Viewer (v7) and a fallback 2D HTML Canvas.

---

### 🚀 Getting Started (First-Time Setup)

To run this project locally, you will need Docker Desktop installed and an Autodesk Developer account.

**1. Get Autodesk Credentials**
* Go to [APS (Autodesk Platform Services)](https://aps.autodesk.com/), create an account, and create a new App.
* Note your **Client ID** and **Client Secret**. Make sure your app has access to the *Data Management API* and *Model Derivative API*.

**2. Configure Environment Variables**
* Duplicate `.env.example` and rename it to `.env`.
* Fill in your APS credentials:
  ```env
  APS_CLIENT_ID=your_client_id_here
  APS_CLIENT_SECRET=your_client_secret_here
  APS_BUCKET=crack-inspector-bucket
  PORT=3000
  ML_SERVICE_URL=http://ml-service:8000
  ```

**3. Build and Run**
* Open a terminal in the root directory and run:
  ```bash
  docker compose up --build
  ```
* Docker will build the Node server, pull the Python environment, and install dependencies via `pip`.
* Once running, open your browser to **`http://localhost:3000`**.

---

### 🗺️ Repository Map

Here is where to find the core functionality if you are assigned a ticket:

* **`/server` (Node.js Backend)**
  * `routes/models.js`: Handles uploading CAD/BIM files to Autodesk OSS buckets and translating them into viewable formats.
  * `routes/inspect.js`: Acts as a proxy, taking uploaded photos from the frontend and forwarding them to the ML service.
  * `routes/auth.js`: Manages 2-legged OAuth token generation for APS.
  * `public/viewer.js`: The frontend brains. It contains `CrackOverlayExtension` (custom code to draw bounding boxes on the 3D viewer) and the `switchToCanvas` logic for 2D image fallbacks.

* **`/ml-service` (Python AI Service)**
  * `app.py`: The FastAPI application. It loads the YOLO model on startup and exposes the `/predict` endpoint to process images and return bounding boxes/polygons.
  * `train.py`: A utility script for fine-tuning the YOLO model. You can run it inside the container to download the `crack-seg` dataset and train a fresh `.pt` model file.

---

### 🧠 Core Workflows (How it works)

**1. The 3D Model Flow**
When a user uploads a `.rvt` or `.dwg` file, the Node server uploads it to an APS bucket. It then triggers the Model Derivative API to convert it to SVF2 (a web-friendly format). The frontend actively polls the `/status` endpoint until translation is complete, then loads the model into the APS Viewer.

**2. The Detection Flow**
When a user uploads a photo of a crack, it is sent to the Node server, which forwards it to the Python ML container. The YOLO model processes the image and returns an array of detections (coordinates, confidence scores, and mask polygons). 
* *If a 3D model is active:* The frontend uses the `CrackOverlayExtension` to map those coordinates over the APS Viewer.
* *If no model is active:* The frontend falls back to drawing the photo and the defect polygons on a standard 2D HTML `<canvas>`.