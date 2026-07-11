const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');
const env = require('../config/env');
const { supabase, TABLES } = require('../lib/supabase');
const { encrypt } = require('../lib/encryption');
const { getModule } = require('../modules');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const logger = require('../lib/logger');

const router = express.Router();

// In-memory state store keyed by random state token -> { userId, expiresAt }.
// Fine for a single-instance deployment; move to Supabase/Redis if you scale
// to multiple server instances behind a load balancer.
const pendingStates = new Map();

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(state);
  }
}

// GET /oauth/google/start?module=gmail
// Requires API key auth so we know which user is connecting.
router.get('/google/start', apiKeyAuth, (req, res) => {
  const moduleName = req.query.module;
  const mod = moduleName && getModule(moduleName);

  if (!mod || mod.provider !== 'google') {
    return res.status(400).json({ error: 'invalid_module', message: 'Provide ?module=<a registered google module>' });
  }

  cleanupExpiredStates();
  const state = crypto.randomBytes(24).toString('base64url');
  pendingStates.set(state, { userId: req.user.id, moduleName, expiresAt: Date.now() + 10 * 60 * 1000 });

  const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
  const url = client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token
    prompt: 'consent', // ensures refresh_token is returned even on repeat connects
    scope: mod.requiredScopes,
    state,
  });

  res.json({ authUrl: url });
});

// GET /oauth/google/callback?code=...&state=...
// No apiKeyAuth here - this is hit by Google's redirect, not our own client.
// The `state` value is what ties this callback back to a known user.
router.get('/google/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.status(400).send(`Google OAuth error: ${oauthError}`);
  }

  const entry = pendingStates.get(state);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(400).send('Invalid or expired OAuth state. Please restart the connection flow.');
  }
  pendingStates.delete(state); // one-time use

  try {
    const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      logger.warn('[oauth] No refresh_token returned - user may have connected before without revoking access');
    }

    // Set credentials on the OAuth2 client so it can make authenticated requests
    client.setCredentials(tokens);
    
    // Verify the access token is present before making the request
    const creds = client.credentials;
    if (!creds.access_token) {
      logger.error('[oauth] No access token available after setting credentials');
      return res.status(500).send('OAuth token exchange failed - no access token.');
    }
    
    // Use the OAuth2 client to make an authenticated request directly
    // This is more reliable than using google.oauth2() wrapper
    const userinfoRes = await client.requestAsync({
      url: 'https://www.googleapis.com/oauth2/v2/userinfo',
    });
    const profile = userinfoRes.data;

    const { error: insertError } = await supabase.from(TABLES.CONNECTIONS).insert({
      user_id: entry.userId,
      provider: 'google',
      account_label: profile.email,
      access_token: encrypt(tokens.access_token),
      refresh_token: encrypt(tokens.refresh_token || ''),
      expires_at: new Date(tokens.expiry_date).toISOString(),
      scopes: (tokens.scope || '').split(' '),
      status: 'active',
    });

    if (insertError) {
      logger.error({ err: insertError }, '[oauth] failed to store connection');
      return res.status(500).send('Failed to save connection.');
    }

    // Redirect back to your frontend UI - adjust to your actual app URL.
    res.redirect(`${env.publicBaseUrl}/connected?provider=google&email=${encodeURIComponent(profile.email)}`);
  } catch (err) {
    logger.error({ err }, '[oauth] token exchange failed');
    res.status(500).send('OAuth token exchange failed.');
  }
});

module.exports = router;
