"""
app.py - Crack Inspector ML Inference Service
==============================================
This is the core inference API for the Autodesk Crack Inspector.
It exposes a FastAPI server that accepts uploaded images, runs them
through a YOLOv8 instance-segmentation model, and returns detected
cracks with bounding boxes and segmentation mask polygons.

The service is designed to run inside a Docker container and is
called by the Node.js backend server whenever a user requests
crack analysis on a captured viewport from the Autodesk viewer.

Flow:
  1. On startup, the YOLO model is loaded into memory once.
  2. The /predict endpoint receives an image from the backend.
  3. YOLOv8 runs instance segmentation to find cracks.
  4. Results (bounding boxes, confidence scores, mask polygons)
     are returned as JSON so the frontend can overlay them on
     the 3D model viewer.
"""

# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------
import os                          # For reading environment variables (MODEL_PATH)
import io                          # For wrapping raw bytes into a file-like object
from fastapi import FastAPI, UploadFile, File, Query  # Web framework and parameter types
from fastapi.middleware.cors import CORSMiddleware     # Allow cross-origin requests
from PIL import Image              # Pillow -- used to decode uploaded images
from ultralytics import YOLO       # YOLOv8 model loader and inference engine

# ---------------------------------------------------------------------------
# FastAPI Application Setup
# ---------------------------------------------------------------------------
# Create the FastAPI app instance with a descriptive title (shown in auto-docs).
app = FastAPI(title="Crack Inspector ML Service")

# Enable CORS so the frontend (served from a different origin/port) can call
# this API without being blocked by the browser's same-origin policy.
# In production you would restrict allow_origins to your actual domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # Accept requests from any origin
    allow_methods=["*"],       # Allow all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],       # Allow all request headers
)

# ---------------------------------------------------------------------------
# Model Configuration
# ---------------------------------------------------------------------------
# MODEL_PATH is set via an environment variable in docker-compose.yml.
# It defaults to the medium-size YOLOv8 segmentation model, but after
# training on the crack dataset it should point to best.pt for accuracy.
MODEL_PATH = os.getenv("MODEL_PATH", "yolov8m-seg.pt")

# The model object is initialized to None and populated at startup.
# Keeping it as a module-level global lets every request reuse the same
# loaded model without re-reading weights from disk each time.
model = None


# ---------------------------------------------------------------------------
# Startup Event -- Load the YOLO Model
# ---------------------------------------------------------------------------
@app.on_event("startup")
def load_model():
    """
    Called automatically by FastAPI when the server starts.
    Loads the YOLO segmentation model into GPU/CPU memory so it is
    ready to serve predictions immediately when the first request arrives.
    This avoids a cold-start delay on the first /predict call.
    """
    global model
    model = YOLO(MODEL_PATH)
    print(f"Model loaded from {MODEL_PATH}")


# ---------------------------------------------------------------------------
# Health Check Endpoint
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    """
    GET /health
    Simple liveness/readiness probe used by Docker health checks and the
    Node.js backend to verify this service is running and the model is loaded.
    Returns {"status": "ok", "model_loaded": true/false}.
    """
    return {"status": "ok", "model_loaded": model is not None}


# ---------------------------------------------------------------------------
# Prediction Endpoint -- Core Crack Detection Logic
# ---------------------------------------------------------------------------
@app.post("/predict")
async def predict(
    file: UploadFile = File(...),                           # The image file sent as multipart form data
    confidence: float = Query(0.25, ge=0.0, le=1.0),       # Minimum confidence threshold (0-1)
):
    """
    POST /predict
    Accepts an image file and an optional confidence threshold, runs YOLOv8
    instance segmentation, and returns a JSON payload with all detected cracks.

    Request:
        - file (multipart):   The image to analyze (JPEG, PNG, etc.)
        - confidence (query): Minimum detection confidence; detections below
                              this threshold are discarded. Default is 0.25.

    Response JSON:
        {
            "detections": [
                {
                    "bbox": [x1, y1, x2, y2],       # Bounding box corners (pixels)
                    "confidence": 0.87,              # Model confidence score
                    "class": "crack",                # Predicted class label
                    "mask_polygon": [[x,y], ...]     # Segmentation contour points
                },
                ...
            ],
            "image_width": 1920,
            "image_height": 1080
        }
    """
    import traceback  # Imported here to keep it scoped to error handling

    # ------------------------------------------------------------------
    # Step 1: Read and decode the uploaded image
    # ------------------------------------------------------------------
    try:
        # Read the raw bytes from the uploaded file
        contents = await file.read()

        # Wrap the bytes in a BytesIO stream so Pillow can open it,
        # then convert to RGB to ensure a consistent 3-channel format
        # (some PNGs may have alpha channels that YOLO does not expect).
        image = Image.open(io.BytesIO(contents)).convert("RGB")

        # Capture image dimensions -- these are returned in the response
        # so the frontend knows the coordinate space of the detections.
        width, height = image.size
        print(f"Running inference on {width}x{height} image, conf={confidence}")
    except Exception as e:
        # If the uploaded file is corrupt or not a valid image, log the
        # full traceback for debugging and re-raise so FastAPI returns a 500.
        print(f"Image load error: {e}")
        traceback.print_exc()
        raise

    # ------------------------------------------------------------------
    # Step 2: Run YOLOv8 inference (instance segmentation)
    # ------------------------------------------------------------------
    try:
        # model.predict() runs the full detection + segmentation pipeline.
        # - source: the PIL image to analyze
        # - conf:   minimum confidence threshold to keep a detection
        # - task:   "segment" tells YOLO to produce masks in addition to boxes
        results = model.predict(source=image, conf=confidence, task="segment")
    except Exception as e:
        # Log inference errors separately so we can distinguish between
        # bad input images vs. model/runtime failures.
        print(f"Inference error: {e}")
        traceback.print_exc()
        raise

    # ------------------------------------------------------------------
    # Step 3: Parse YOLO results into a JSON-serializable format
    # ------------------------------------------------------------------
    detections = []            # Accumulator for all detected crack objects
    result = results[0]        # results is a list; we sent one image, so take index 0

    # Check whether any bounding boxes were detected in the image
    if result.boxes is not None:
        # Iterate over each detected object (box) in the image
        for i, box in enumerate(result.boxes):
            # Build the base detection dictionary with:
            #   - bbox:       [x1, y1, x2, y2] pixel coordinates of the bounding box
            #   - confidence: float score indicating how confident the model is
            #   - class:      human-readable class name (e.g. "crack")
            det = {
                "bbox": box.xyxy[0].tolist(),
                "confidence": float(box.conf[0]),
                "class": result.names[int(box.cls[0])],
            }

            # If segmentation masks are available, attach the polygon contour.
            # The mask polygon is a list of [x, y] coordinate pairs that trace
            # the outline of the detected crack. The frontend uses this to draw
            # a precise overlay on the 3D viewer instead of just a rectangle.
            if result.masks is not None and i < len(result.masks):
                mask_xy = result.masks[i].xy       # Array of polygon contour points
                if len(mask_xy) > 0:
                    det["mask_polygon"] = mask_xy[0].tolist()

            detections.append(det)

    # ------------------------------------------------------------------
    # Step 4: Return the detection results as JSON
    # ------------------------------------------------------------------
    # The response includes the list of detections plus the original image
    # dimensions, which the frontend needs to correctly scale and position
    # the bounding boxes and mask overlays on the rendered viewer.
    return {
        "detections": detections,
        "image_width": width,
        "image_height": height,
    }
