const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

function getKeyBuffer() {
  const keyHex = env.encryption.key;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypts a plaintext string. Returns a single string safe to store in a
 * text column: version.iv.authTag.ciphertext (all base64 except version).
 */
function encrypt(plaintext) {
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    env.encryption.keyVersion,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

/**
 * Decrypts a string produced by encrypt(). Throws if tampered or wrong key.
 */
function decrypt(payload) {
  const [, ivB64, authTagB64, dataB64] = String(payload).split('.');
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload');
  }

  const key = getKeyBuffer();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

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

module.exports = { encrypt, decrypt, hashApiKey, generateApiKey };
