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

  const result = await authClient.getTwoLeggedToken(clientId, clientSecret, [
    Scopes.DataRead,
    Scopes.DataCreate,
    Scopes.BucketCreate,
    Scopes.ViewablesRead,
  ]);

  cachedToken = result.access_token;
  // Refresh 60 seconds before expiry
  tokenExpiresAt = Date.now() + (result.expires_in - 60) * 1000;

  return cachedToken;
}

router.get('/token', async (req, res, next) => {
  try {
    const token = await getToken();
    res.json({ access_token: token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.getToken = getToken;
