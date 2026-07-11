const crypto = require('crypto');

/**
 * Hashes an API key for storage/lookup (one-way, not reversible).
 * Raw API keys are shown to the user once and never stored in plaintext.
 */
function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function generateApiKey() {
  const raw = 'sm_live_' + crypto.randomBytes(24).toString('base64url');
  return { raw, hash: hashApiKey(raw) };
}

module.exports = { hashApiKey, generateApiKey };
