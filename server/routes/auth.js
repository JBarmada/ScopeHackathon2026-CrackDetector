/**
 * routes/auth.js — Autodesk Platform Services (APS) authentication module.
 *
 * This module handles OAuth 2.0 two-legged (client-credentials) authentication
 * with Autodesk's cloud platform. It exposes:
 *
 *   GET /api/auth/token  — Returns a *public* (read-only) access token that
 *                          the browser-side Viewer can safely use.
 *
 * Internally it also exports a getToken() helper that returns a *private*
 * (read/write) token used by other server-side route modules (e.g. models.js)
 * to upload files, create buckets, and start translation jobs.
 *
 * Both tokens are cached in memory and automatically refreshed 60 seconds
 * before they expire, avoiding unnecessary round-trips to the APS auth server.
 */

const express = require('express');
const { AuthenticationClient, Scopes } = require('@aps_sdk/authentication');

const router = express.Router();

// Instantiate the APS authentication client (uses default APS endpoints).
const authClient = new AuthenticationClient();

// ---------------------------------------------------------------------------
// PUBLIC token cache — read-only, safe to expose to the browser Viewer
// ---------------------------------------------------------------------------
let cachedToken = null;     // The most recently fetched public access token string
let tokenExpiresAt = 0;     // Timestamp (ms) at which the cached token is considered stale

/**
 * getToken (public / viewer token)
 *
 * Returns a cached APS access token with ViewablesRead scope only. This token
 * is intended to be sent to the browser so the Autodesk Viewer can load
 * translated model geometry without granting any write permissions.
 *
 * If the cached token is still valid, it is returned immediately.
 * Otherwise a fresh two-legged token is requested from the APS auth server.
 *
 * @returns {Promise<string>} An APS access token string.
 * @throws Will throw if APS_CLIENT_ID / APS_CLIENT_SECRET are not configured.
 */
async function getToken() {
  // Return the cached token if it has not yet expired
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  // Read credentials from environment variables set in the .env file
  const clientId = process.env.APS_CLIENT_ID;
  const clientSecret = process.env.APS_CLIENT_SECRET;

  // Guard: credentials must be present for any APS API call to succeed
  if (!clientId || !clientSecret) {
    throw new Error('APS_CLIENT_ID and APS_CLIENT_SECRET must be set in .env');
  }

  // Request a two-legged OAuth token with read-only Viewer scope.
  // "Two-legged" means app-level auth — no user login required.
  // ViewablesRead is the minimum scope needed to load a model in the Viewer.
  const result = await authClient.getTwoLeggedToken(clientId, clientSecret, [
    Scopes.ViewablesRead,
  ]);

  // Cache the token string for subsequent requests
  cachedToken = result.access_token;

  // Schedule a refresh 60 seconds before the token actually expires.
  // This prevents edge cases where the token expires mid-request.
  tokenExpiresAt = Date.now() + (result.expires_in - 60) * 1000;

  return cachedToken;
}

// ---------------------------------------------------------------------------
// GET /api/auth/token — Public endpoint consumed by the browser Viewer
// ---------------------------------------------------------------------------
// A lightweight origin check prevents random third-party sites from harvesting
// tokens. This is NOT a security boundary (the token is read-only anyway), but
// it adds a basic layer of protection against casual misuse.
router.get('/token', async (req, res, next) => {
  // Determine the request origin to perform a same-origin sanity check
  const origin = req.headers.origin || req.headers.referer || '';
  const host = req.headers.host || '';

  // Allow the request if:
  //   - The origin header matches the server's own host (same-origin), OR
  //   - There is no origin header and the request is an XHR (likely a same-origin fetch)
  const isLocal = origin.includes(host) || origin === '' && req.headers['x-requested-with'] === 'XMLHttpRequest';

  // Reject requests that come from a clearly different origin
  if (!isLocal && origin !== '') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Obtain a read-only token (from cache or fresh) and send it to the client
    const token = await getToken();
    res.json({ access_token: token });
  } catch (err) {
    // Forward any authentication errors to the global error handler
    next(err);
  }
});

// ---------------------------------------------------------------------------
// INTERNAL (server-side) token cache — full read/write permissions
// ---------------------------------------------------------------------------
// This token is NEVER sent to the browser. It is used by other route modules
// (models.js) to perform privileged operations: creating buckets, uploading
// files, starting translation jobs, and deleting objects.
let cachedInternalToken = null;    // The most recently fetched internal access token string
let internalTokenExpiresAt = 0;    // Timestamp (ms) at which the internal token is considered stale

/**
 * getInternalToken (private / server-side token)
 *
 * Returns a cached APS access token with broad data and bucket permissions.
 * This token must stay server-side and should never be exposed to the browser.
 *
 * Scopes granted:
 *   - DataRead      — Read object data from OSS buckets
 *   - DataWrite     — Overwrite / update objects in OSS buckets
 *   - DataCreate    — Upload new objects to OSS buckets
 *   - BucketCreate  — Create new OSS buckets
 *   - ViewablesRead — Read translated model viewables (needed for manifest checks)
 *
 * @returns {Promise<string>} An APS access token string.
 */
async function getInternalToken() {
  // Return the cached internal token if it has not yet expired
  if (cachedInternalToken && Date.now() < internalTokenExpiresAt) {
    return cachedInternalToken;
  }

  // Read credentials from environment variables
  const clientId = process.env.APS_CLIENT_ID;
  const clientSecret = process.env.APS_CLIENT_SECRET;

  // Request a two-legged token with full data-management scopes
  const result = await authClient.getTwoLeggedToken(clientId, clientSecret, [
    Scopes.DataRead,
    Scopes.DataWrite,
    Scopes.DataCreate,
    Scopes.BucketCreate,
    Scopes.ViewablesRead,
  ]);

  // Cache the token and set a refresh threshold 60 seconds before expiry
  cachedInternalToken = result.access_token;
  internalTokenExpiresAt = Date.now() + (result.expires_in - 60) * 1000;
  return cachedInternalToken;
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------
// Export the router so server.js can mount it at /api/auth.
module.exports = router;

// Export the *internal* (privileged) token getter so other route modules
// (models.js, etc.) can authenticate their server-side APS API calls.
module.exports.getToken = getInternalToken;
