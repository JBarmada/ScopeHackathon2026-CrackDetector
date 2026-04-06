# Python runtime for FastAPI + YOLOv8 inference.
FROM python:3.11-slim

# Install minimal OS libraries required by OpenCV/Ultralytics.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory for app code and model runtime assets.
WORKDIR /app

# Install Python dependencies before copying the full source for better caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy API code and training script.
COPY . .

# Ensure model mount point exists (host volume maps to /app/models).
RUN mkdir -p /app/models

# Expose FastAPI/uvicorn port.
EXPOSE 8000

# Start inference API.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
