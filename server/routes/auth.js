const express = require('express');
const { AuthenticationClient, Scopes } = require('@aps_sdk/authentication');

const router = express.Router();
const authClient = new AuthenticationClient();

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.APS_CLIENT_ID;
  const clientSecret = process.env.APS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('APS_CLIENT_ID and APS_CLIENT_SECRET must be set in .env');
  }

  // Public token: read-only, safe to give to the browser viewer
  const result = await authClient.getTwoLeggedToken(clientId, clientSecret, [
    Scopes.ViewablesRead,
  ]);

  cachedToken = result.access_token;
  // Refresh 60 seconds before expiry
  tokenExpiresAt = Date.now() + (result.expires_in - 60) * 1000;

  return cachedToken;
}

router.get('/token', async (req, res, next) => {
  const origin = req.headers.origin || req.headers.referer || '';
  const host = req.headers.host || '';
  const isLocal = origin.includes(host) || origin === '' && req.headers['x-requested-with'] === 'XMLHttpRequest';

  if (!isLocal && origin !== '') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const token = await getToken();
    res.json({ access_token: token });
  } catch (err) {
    next(err);
  }
});

let cachedInternalToken = null;
let internalTokenExpiresAt = 0;

async function getInternalToken() {
  if (cachedInternalToken && Date.now() < internalTokenExpiresAt) {
    return cachedInternalToken;
  }

  const clientId = process.env.APS_CLIENT_ID;
  const clientSecret = process.env.APS_CLIENT_SECRET;

  const result = await authClient.getTwoLeggedToken(clientId, clientSecret, [
    Scopes.DataRead,
    Scopes.DataWrite,
    Scopes.DataCreate,
    Scopes.BucketCreate,
    Scopes.ViewablesRead,
  ]);

  cachedInternalToken = result.access_token;
  internalTokenExpiresAt = Date.now() + (result.expires_in - 60) * 1000;
  return cachedInternalToken;
}

module.exports = router;
module.exports.getToken = getInternalToken;
