/**
 * routes/models.js — CAD/BIM model management via Autodesk Platform Services.
 *
 * This module handles the full lifecycle of a 3D model:
 *   1. Upload a file to the APS Object Storage Service (OSS).
 *   2. Kick off a Model Derivative translation job so the Viewer can display it.
 *   3. Poll the translation status until the model is ready.
 *   4. List all previously uploaded models in the bucket.
 *   5. Delete a model from the bucket when no longer needed.
 *
 * Endpoints:
 *   POST   /api/models/upload       — Upload a file and start SVF2 translation
 *   GET    /api/models/:urn/status  — Check translation progress for a given URN
 *   GET    /api/models              — List all models in the OSS bucket
 *   DELETE /api/models/:objectKey   — Remove a model from the bucket
 *
 * All APS API calls use the internal (server-side) token from auth.js, which
 * has full read/write/create permissions and is never exposed to the browser.
 */

const express = require('express');
const multer = require('multer');
const { OssClient } = require('@aps_sdk/oss');
const { ModelDerivativeClient, OutputType, View } = require('@aps_sdk/model-derivative');
const { getToken } = require('./auth');

const router = express.Router();

// Configure multer for in-memory file uploads.
// Files are held in a buffer (not written to disk) so we can stream them
// directly to the APS OSS API. Max file size is capped at 200 MB.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// Instantiate APS SDK clients for Object Storage and Model Derivative services
const ossClient = new OssClient();    // Manages file uploads, listings, and deletions in OSS buckets
const mdClient = new ModelDerivativeClient(); // Manages translation jobs and manifest retrieval

// The OSS bucket where all uploaded CAD/BIM files are stored.
// Defaults to "crack-inspector-bucket" if the APS_BUCKET env var is not set.
const BUCKET_KEY = process.env.APS_BUCKET || 'crack-inspector-bucket';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * toBase64Urn
 *
 * Converts a plain-text APS object URN into a URL-safe Base64 string.
 * The Model Derivative API requires URNs to be Base64-encoded, and any
 * trailing "=" padding characters must be stripped.
 *
 * @param {string} urn — A plain-text URN like "urn:adsk.objects:os.object:bucket/file"
 * @returns {string}   — The Base64-encoded URN with padding removed
 */
function toBase64Urn(urn) {
  return Buffer.from(urn).toString('base64').replace(/=/g, '');
}

/**
 * ensureBucket
 *
 * Creates the OSS bucket if it does not already exist. The bucket uses a
 * "transient" retention policy, meaning objects are automatically deleted
 * after 24 hours. This keeps storage costs low for a hackathon demo.
 *
 * If the bucket already exists, the APS API returns a 409 Conflict error,
 * which we silently ignore. Any other error is re-thrown.
 *
 * @param {string} token — A valid APS access token with BucketCreate scope
 */
async function ensureBucket(token) {
  try {
    await ossClient.createBucket(
      'US',
      { bucketKey: BUCKET_KEY, policyKey: 'transient' },
      { accessToken: token },
    );
  } catch (err) {
    // 409 Conflict means the bucket already exists — that is perfectly fine.
    // We check multiple places because the APS SDK surfaces the status code
    // inconsistently depending on the SDK version.
    if (!err.message?.includes('409') && err.statusCode !== 409 && err.axiosError?.response?.status !== 409) {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/models/upload — Upload a CAD/BIM file and begin translation
// ---------------------------------------------------------------------------
// Flow:
//   1. Receive the file from the browser via multipart form-data.
//   2. Ensure the target OSS bucket exists (create it if necessary).
//   3. Upload the file buffer to OSS with a unique timestamp-prefixed key.
//   4. Start a Model Derivative translation job to convert the file into
//      SVF2 format (the optimised format consumed by the Autodesk Viewer).
//   5. Return the Base64-encoded URN so the client can poll for status.
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    // Validate that a file was actually included in the request
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Obtain a privileged server-side token for APS API calls
    const token = await getToken();

    // Make sure the OSS bucket exists before attempting to upload
    await ensureBucket(token);

    // Prefix the original filename with a timestamp to guarantee uniqueness
    // and prevent collisions when the same file is uploaded multiple times.
    const objectKey = `${Date.now()}-${req.file.originalname}`;

    // Upload the file buffer directly to the APS Object Storage Service
    await ossClient.uploadObject(
      BUCKET_KEY,
      objectKey,
      req.file.buffer,
      { accessToken: token },
    );

    // Construct the full URN that identifies this object in APS, then
    // Base64-encode it for use with the Model Derivative API.
    const objectUrn = `urn:adsk.objects:os.object:${BUCKET_KEY}/${objectKey}`;
    const base64Urn = toBase64Urn(objectUrn);

    // Kick off a translation job that converts the uploaded file into SVF2.
    // SVF2 is Autodesk's optimised streaming format for the web Viewer.
    // We request both 2D and 3D views so drawings and 3D models are covered.
    await mdClient.startJob(
      {
        input: { urn: base64Urn },
        output: {
          formats: [{ type: OutputType.Svf2, views: [View._2d, View._3d] }],
        },
      },
      { accessToken: token },
    );

    // Return the URN and object key to the client. The client will use the
    // URN to poll the /status endpoint until translation is complete.
    res.json({ urn: base64Urn, objectKey, status: 'processing' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/models/:urn/status — Check translation progress
// ---------------------------------------------------------------------------
// The client polls this endpoint after uploading a file to determine when
// the Model Derivative translation is complete. The response includes:
//   - status:   "pending", "inprogress", "success", or "failed"
//   - progress: A human-readable progress string (e.g. "50% complete")
router.get('/:urn/status', async (req, res, next) => {
  try {
    const token = await getToken();

    // Retrieve the translation manifest for the given URN. The manifest
    // contains the overall translation status and per-derivative progress.
    const manifest = await mdClient.getManifest(
      req.params.urn,
      { accessToken: token },
    );

    res.json({ status: manifest.status, progress: manifest.progress });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/models — List all uploaded models in the OSS bucket
// ---------------------------------------------------------------------------
// Returns an array of { name, urn } objects representing every file currently
// stored in the bucket. The front-end uses this to populate the model picker.
// If APS credentials are missing or the bucket does not exist yet, an empty
// array is returned gracefully instead of an error.
router.get('/', async (req, res, next) => {
  try {
    const token = await getToken();

    // Fetch all objects in the bucket from the OSS API
    const objects = await ossClient.getObjects(
      BUCKET_KEY,
      { accessToken: token },
    );

    // Map each raw OSS object to a simpler { name, urn } shape for the client.
    // The URN is Base64-encoded so it can be passed directly to the Viewer.
    const items = (objects.items || []).map((obj) => ({
      name: obj.objectKey,
      urn: toBase64Urn(`urn:adsk.objects:os.object:${BUCKET_KEY}/${obj.objectKey}`),
    }));

    res.json(items);
  } catch (err) {
    // If APS is not configured or the bucket has not been created yet,
    // return an empty list so the front-end can handle it gracefully
    // (e.g. show "No models uploaded yet" instead of crashing).
    console.warn('Could not list models (APS not configured?):', err.message);
    res.json([]);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/models/:objectKey — Remove a model from the OSS bucket
// ---------------------------------------------------------------------------
// Permanently deletes the specified object from the bucket. The objectKey
// is the timestamp-prefixed filename that was returned during upload.
router.delete('/:objectKey', async (req, res, next) => {
  try {
    const token = await getToken();

    // Delete the object from the APS Object Storage Service
    await ossClient.deleteObject(
      BUCKET_KEY,
      req.params.objectKey,
      { accessToken: token },
    );

    // Confirm the deletion to the client
    res.json({ deleted: req.params.objectKey });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
