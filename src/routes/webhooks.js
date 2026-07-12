const express = require('express');
const crypto = require('crypto');
const env = require('../config/env');
const { webhookRateLimiter } = require('../middleware/rateLimiter');
const logger = require('../lib/logger');

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
 * Apps Script should send: { secret, source, data }
 */
router.post('/generic/:source', express.json(), (req, res) => {
  const { source } = req.params;
  const { secret, data } = req.body || {};

  // TODO: validate `secret` against a per-user webhook secret stored in
  // sm_connections or a dedicated sm_webhook_secrets table once that's built.
  //
  // TODO (sheets): once this is wired up to actually find and run matching
  // flows, the sheets `rowChange` trigger is inclusive - its trigger_config
  // carries `events: ['added']`, `['updated']`, or both. Only fire a flow
  // whose config.events includes `data.eventType` ('added'|'updated'), e.g.
  //   const flowTriggerConfig = flow.trigger_config; // { module, trigger, config }
  //   if (source === 'sheets' && !flowTriggerConfig.config.events.includes(data.eventType)) return;
  logger.info({ source, data }, '[webhooks] generic event received');

  res.status(200).json({ received: true });
});

module.exports = router;
