const express = require('express');
const crypto = require('crypto');
const env = require('../config/env');
const { webhookRateLimiter } = require('../middleware/rateLimiter');
const logger = require('../lib/logger');
const { supabase, TABLES } = require('../lib/supabase');
const { hashApiKey } = require('../lib/encryption');
const { runFlow } = require('../lib/flowRunner');

const router = express.Router();
router.use(webhookRateLimiter);

/**
 * Meta (Facebook/Instagram) webhook verification handshake.
 * Meta calls this once when you register the callback URL in the App
 * Dashboard, with hub.mode=subscribe & a challenge to echo back.
 */
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.meta.webhookVerifyToken) {
    logger.info('[webhooks] Meta webhook verified');
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Verification failed');
});

/**
 * Meta sends actual events here (POST) - new comments, messages, etc.
 * Meta signs the payload with X-Hub-Signature-256 using your app secret;
 * verify it so random requests can't be replayed as fake events.
 */
router.post('/meta', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-hub-signature-256'];

  if (!verifyMetaSignature(req.body, signature)) {
    logger.warn('[webhooks] Meta signature verification failed');
    return res.status(401).send('Invalid signature');
  }

  const payload = JSON.parse(req.body.toString('utf8'));
  logger.info({ payload }, '[webhooks] Meta event received');

  // TODO: route payload to the relevant flow(s) once flows are built.
  // For now, just acknowledge receipt quickly (Meta expects a fast 200).
  res.status(200).send('EVENT_RECEIVED');
});

function verifyMetaSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !env.meta.appSecret) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', env.meta.appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false; // length mismatch etc.
  }
}

/**
 * Generic inbound webhook for things like Google Apps Script bound
 * triggers (onFormSubmit / onEdit) calling out to us directly, since
 * Sheets/Forms have no native push webhook of their own.
 *
 * Apps Script should send: { secret, source, data }
 *   - secret: the user's own API key (sm_live_xxxx) - reuses the same
 *     sm_api_keys table apiKeyAuth checks, just read from the body since
 *     Apps Script's UrlFetchApp can't easily set a custom Authorization
 *     header alongside a public-facing doPost().
 *   - source: matches a module's trigger `webhookSource` (currently only
 *     "sheets" - see src/modules/sheets.js `rowChange`).
 *   - data: the trigger's outputSchema shape, PLUS whatever fields are
 *     needed to identify which flow it belongs to. For sheets that's
 *     `spreadsheetId` (a user can have flows on multiple spreadsheets) -
 *     make sure the Apps Script payload includes it alongside
 *     eventType/sheetName/rowNumber/values.
 */
router.post('/generic/:source', express.json(), async (req, res) => {
  const { source } = req.params;
  const { secret, data } = req.body || {};

  if (!secret) {
    return res.status(401).json({ error: 'missing_secret' });
  }

  try {
    const keyHash = hashApiKey(secret);
    const { data: keyRow, error: keyError } = await supabase
      .from(TABLES.API_KEYS)
      .select('id, user_id, revoked_at')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (keyError) {
      logger.error({ err: keyError }, '[webhooks] api key lookup failed');
      return res.status(500).json({ error: 'internal_error' });
    }
    if (!keyRow || keyRow.revoked_at) {
      return res.status(401).json({ error: 'invalid_secret' });
    }

    // Every webhook-triggered flow this user has for this source module.
    const { data: flows, error: flowsError } = await supabase
      .from(TABLES.FLOWS)
      .select('id, is_active, trigger_config')
      .eq('user_id', keyRow.user_id)
      .eq('trigger_type', 'webhook')
      .eq('trigger_config->>module', source);

    if (flowsError) {
      logger.error({ err: flowsError }, '[webhooks] flow lookup failed');
      return res.status(500).json({ error: 'internal_error' });
    }

    const matches = (flows || []).filter((flow) => {
      if (!flow.is_active) return false;
      const cfg = (flow.trigger_config && flow.trigger_config.config) || {};

      // sheets rowChange is scoped to a spreadsheet (+ optional sheet name)
      // and its `events` is inclusive (added/updated/both) - only fire for
      // flows that actually asked for this spreadsheet/sheet/event type.
      if (source === 'sheets') {
        if (cfg.spreadsheetId && data?.spreadsheetId && cfg.spreadsheetId !== data.spreadsheetId) return false;
        if (cfg.sheetName && data?.sheetName && cfg.sheetName !== data.sheetName) return false;
        if (Array.isArray(cfg.events) && data?.eventType && !cfg.events.includes(data.eventType)) return false;
      }
      return true;
    });

    logger.info({ source, matchCount: matches.length }, '[webhooks] generic event received');

    // Kick off matching flows without making Apps Script wait on all of
    // them to finish - Apps Script's UrlFetchApp has its own timeout, and
    // there's no reason a slow flow should make the trigger look "failed".
    for (const flow of matches) {
      runFlow(flow.id, keyRow.user_id, data).catch((err) => {
        logger.error({ err, flowId: flow.id }, '[webhooks] triggered flow run failed');
      });
    }

    res.status(200).json({ received: true, flowsTriggered: matches.length });
  } catch (err) {
    logger.error({ err }, '[webhooks] generic handler failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
