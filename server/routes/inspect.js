/**
 * routes/inspect.js — Crack detection proxy to the YOLOv8 ML micro-service.
 *
 * This module acts as a bridge between the browser front-end and the
 * Python-based machine-learning service that runs YOLOv8 inference for
 * crack detection. The ML service is typically running inside a Docker
 * container (see docker-compose.yml) and is not directly accessible from
 * the browser, so this Express route proxies the request.
 *
 * Flow:
 *   1. The browser uploads an image via multipart form-data.
 *   2. This route re-packages the image into a new FormData payload.
 *   3. The payload is forwarded to the ML service's /predict endpoint.
 *   4. The ML service runs YOLOv8 inference and returns JSON results
 *      (bounding boxes, confidence scores, class labels).
 *   5. This route relays the JSON response back to the browser.
 *
 * Endpoint:
 *   POST /api/inspect/detect?confidence=0.25
 *     - Body: multipart form-data with a single "file" field (image)
 *     - Query param "confidence": minimum detection confidence threshold
 *       (defaults to 0.25 if not provided)
 *     - Returns: JSON object with detection results from the ML model
 */

const express = require('express');
const multer = require('multer');

const router = express.Router();

// Configure multer for in-memory file storage. Images are held in a buffer
// so they can be re-sent to the ML service without touching the disk.
// Max file size is capped at 50 MB (images should be well under this).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Base URL of the YOLOv8 ML micro-service. In a Docker Compose environment,
// the service is accessible via its container name "ml-service" on port 8000.
// For local development without Docker, set the ML_SERVICE_URL env var to
// point to wherever the ML service is running (e.g. http://localhost:8000).
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:8000';

// ---------------------------------------------------------------------------
// POST /api/inspect/detect — Forward an image to the ML service for analysis
// ---------------------------------------------------------------------------
router.post('/detect', upload.single('file'), async (req, res, next) => {
  try {
    // Validate that an image file was included in the upload
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Build a new FormData payload to forward the image to the ML service.
    // We wrap the raw buffer in a Blob so the fetch API can transmit it
    // as a proper multipart file upload with the original filename intact.
    const formData = new FormData();
    formData.append('file', new Blob([req.file.buffer]), req.file.originalname);

    // Read the confidence threshold from the query string. The ML service
    // uses this to filter out low-confidence detections. A lower value
    // returns more (but potentially noisier) results; a higher value is
    // more conservative. Default is 0.25 (25%).
    const confidence = req.query.confidence || '0.25';

    // Forward the image to the ML service's /predict endpoint via HTTP POST.
    // The confidence threshold is passed as a query parameter.
    const mlResponse = await fetch(
      `${ML_SERVICE_URL}/predict?confidence=${confidence}`,
      { method: 'POST', body: formData },
    );

    // If the ML service returned a non-OK status, extract the error message
    // and throw so it reaches the global error handler in server.js.
    if (!mlResponse.ok) {
      const errText = await mlResponse.text();
      throw new Error(`ML service error: ${mlResponse.status} ${errText}`);
    }

    // Parse the ML service's JSON response (bounding boxes, scores, labels)
    // and relay it directly to the browser client.
    const result = await mlResponse.json();
    res.json(result);
  } catch (err) {
    // Forward errors (network failures, ML service errors) to the global
    // error handler so they are logged and returned as a clean JSON response.
    next(err);
  }
});

module.exports = router;
