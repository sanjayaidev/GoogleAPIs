const { supabase, TABLES } = require('../lib/supabase');
const { hashApiKey } = require('../lib/encryption');
const logger = require('../lib/logger');

/**
 * Expects header: Authorization: Bearer sm_live_xxxxx
 * Looks up the hash (never the raw key) against sm_api_keys.
 * Attaches req.user = { id } and req.apiKey = { id } on success.
 */
async function apiKeyAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, rawKey] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !rawKey) {
      return res.status(401).json({ error: 'missing_api_key', message: 'Provide: Authorization: Bearer <api_key>' });
    }

    const keyHash = hashApiKey(rawKey);

    const { data, error } = await supabase
      .from(TABLES.API_KEYS)
      .select('id, user_id, revoked_at')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (error) {
      logger.error({ err: error }, '[apiKeyAuth] supabase lookup failed');
      return res.status(500).json({ error: 'internal_error' });
    }

    if (!data || data.revoked_at) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }

    req.user = { id: data.user_id };
    req.apiKey = { id: data.id };

    // Fire-and-forget last_used_at update, doesn't block the request.
    supabase
      .from(TABLES.API_KEYS)
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(() => {})
      .catch((err) => logger.warn({ err }, '[apiKeyAuth] failed to update last_used_at'));

    next();
  } catch (err) {
    logger.error({ err }, '[apiKeyAuth] unexpected error');
    res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = apiKeyAuth;
