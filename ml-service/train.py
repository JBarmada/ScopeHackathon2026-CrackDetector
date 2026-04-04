"""
Train YOLOv8 segmentation on the Ultralytics crack-seg dataset.
Saves best.pt to /app/models/best.pt (mounted volume).

Usage inside Docker:
    docker compose run --rm ml-service python train.py
    docker compose run --rm ml-service python train.py --epochs 20
"""

import argparse
import shutil
import zipfile
import urllib.request
from pathlib import Path
from ultralytics import YOLO, settings

DATASET_URL = "https://github.com/ultralytics/assets/releases/download/v0.0.0/crack-seg.zip"
DATASET_DIR = Path("/app/datasets/images")

def download_dataset():
    if DATASET_DIR.exists():
        print(f"Dataset already at {DATASET_DIR}, skipping download.\n")
        return

    zip_path = Path("/app/datasets/crack-seg.zip")
    zip_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Downloading crack-seg dataset (~91 MB)...")
    urllib.request.urlretrieve(DATASET_URL, zip_path)
    print("Extracting...")
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall("/app/datasets")
    zip_path.unlink()
    # Write a corrected yaml pointing to the actual extracted location
    yaml_path = Path("/app/datasets/crack-seg-fixed.yaml")
    yaml_path.write_text(
        "path: /app/datasets\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        "names:\n"
        "  0: crack\n"
    )
    print(f"Dataset ready. Using yaml at {yaml_path}\n")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=30,
                        help='Number of training epochs (default 30 for speed)')
    parser.add_argument('--model', default='yolo11n-seg.pt',
                        help='Base model: yolo11n-seg.pt (fast) or yolo11m-seg.pt (accurate)')
    parser.add_argument('--imgsz', type=int, default=640)
    args = parser.parse_args()

    download_dataset()

    # Tell Ultralytics where datasets live
    settings.update({'datasets_dir': '/app/datasets'})

    print(f"Training {args.model} for {args.epochs} epochs on crack-seg dataset...")

    model = YOLO(args.model)

    results = model.train(
        data='/app/datasets/crack-seg-fixed.yaml',
        epochs=args.epochs,
        imgsz=args.imgsz,
        project='/app/runs',
        name='crack-train',
        exist_ok=True,
    )

    # Copy best weights to models/ so the app can use them
    best_pt = Path('/app/runs/crack-train/weights/best.pt')
    dest = Path('/app/models/best.pt')

    if best_pt.exists():
        shutil.copy(best_pt, dest)
        print(f"\nDone! Model saved to {dest}")
        print("Now update docker-compose.yml:")
        print("  MODEL_PATH=/app/models/best.pt")
        print("Then restart: docker compose restart ml-service")
    else:
        print(f"Warning: best.pt not found at {best_pt}")

if __name__ == '__main__':
    main()
