import os
import io
from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from ultralytics import YOLO

app = FastAPI(title="Crack Inspector ML Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.getenv("MODEL_PATH", "yolov8m-seg.pt")
model = None


@app.on_event("startup")
def load_model():
    global model
    model = YOLO(MODEL_PATH)
    print(f"Model loaded from {MODEL_PATH}")


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    confidence: float = Query(0.25, ge=0.0, le=1.0),
):
    import traceback
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        width, height = image.size
        print(f"Running inference on {width}x{height} image, conf={confidence}")
    except Exception as e:
        print(f"Image load error: {e}")
        traceback.print_exc()
        raise

    try:
        results = model.predict(source=image, conf=confidence, task="segment")
    except Exception as e:
        print(f"Inference error: {e}")
        traceback.print_exc()
        raise

    detections = []
    result = results[0]

    if result.boxes is not None:
        for i, box in enumerate(result.boxes):
            det = {
                "bbox": box.xyxy[0].tolist(),
                "confidence": float(box.conf[0]),
                "class": result.names[int(box.cls[0])],
            }

            if result.masks is not None and i < len(result.masks):
                mask_xy = result.masks[i].xy
                if len(mask_xy) > 0:
                    det["mask_polygon"] = mask_xy[0].tolist()

            detections.append(det)

    return {
        "detections": detections,
        "image_width": width,
        "image_height": height,
    }
