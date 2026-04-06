/**
 * server.js — Main entry point for the Autodesk Crack Inspector backend.
 *
 * This Express server serves three purposes:
 *   1. Hosts the static front-end (HTML/CSS/JS) from the "public" folder.
 *   2. Provides REST API routes for authentication, model management,
 *      and crack-detection inspection.
 *   3. Acts as a middleware layer between the browser client and both
 *      the Autodesk Platform Services (APS) cloud APIs and the
 *      YOLOv8-based ML micro-service running in Docker.
 *
 * Environment variables are loaded from a .env file via dotenv.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// ---------------------------------------------------------------------------
// Import route modules — each handles a distinct domain of the application
// ---------------------------------------------------------------------------
const authRoutes = require('./routes/auth');       // APS OAuth token management
const modelsRoutes = require('./routes/models');   // File upload, translation, and listing via APS OSS + Model Derivative
const inspectRoutes = require('./routes/inspect'); // Crack detection proxy to the ML micro-service

// ---------------------------------------------------------------------------
// Create the Express application and determine which port to listen on.
// Defaults to port 3000 if the PORT environment variable is not set.
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// Enable Cross-Origin Resource Sharing so the front-end (which may be served
// from a different origin during development) can call these API endpoints.
app.use(cors());

// Parse incoming JSON request bodies (e.g. from fetch calls with Content-Type
// application/json). This is needed for any route that expects a JSON payload.
app.use(express.json());

// Serve the static front-end assets (index.html, style.css, viewer.js, etc.)
// from the "public" directory located alongside this file.
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Mount API route groups
// ---------------------------------------------------------------------------

// Authentication routes — provides browser-safe APS access tokens.
// Example endpoint: GET /api/auth/token
app.use('/api/auth', authRoutes);

// Model routes — upload CAD/BIM files, check translation status, list and
// delete models stored in the APS Object Storage Service (OSS) bucket.
// Example endpoints: POST /api/models/upload, GET /api/models, GET /api/models/:urn/status
app.use('/api/models', modelsRoutes);

// Inspection routes — forward images to the YOLOv8 ML service for crack
// detection and return the prediction results to the client.
// Example endpoint: POST /api/inspect/detect
app.use('/api/inspect', inspectRoutes);

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// Any error thrown (or passed via next(err)) in a route handler ends up here.
// It logs the full error on the server console for debugging and returns a
// sanitised JSON error message to the client with a 500 status code.
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start the HTTP server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Crack Inspector server running on http://localhost:${PORT}`);
});
