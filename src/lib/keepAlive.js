const cron = require('node-cron');
const axios = require('axios');
const env = require('../config/env');
const logger = require('./logger');

/**
 * Render's free tier spins a web service down after ~15 minutes of no
 * inbound HTTP traffic. This self-ping hits our own /health endpoint on a
 * schedule so the service never goes idle long enough to sleep.
 *
 * This is a BACKUP / all-in-one option. If you'd rather not have the
 * process ping itself, disable this (ENABLE_SELF_PING=false) and instead
 * point an external pinger (cron-job.org, UptimeRobot, GitHub Actions
 * schedule, etc.) at:
 *   GET {PUBLIC_BASE_URL}/health
 * every ~14 minutes. Either approach works; don't run both an aggressive
 * internal cron AND a 1-minute external pinger, that's wasted traffic.
 */
function startSelfPing() {
  if (!env.selfPing.enabled) {
    logger.info('[keepAlive] Self-ping disabled (ENABLE_SELF_PING=false)');
    return;
  }

  if (!cron.validate(env.selfPing.cron)) {
    logger.warn(`[keepAlive] Invalid cron expression "${env.selfPing.cron}", self-ping not started`);
    return;
  }

  const target = `${env.publicBaseUrl}/health`;

  cron.schedule(env.selfPing.cron, async () => {
    try {
      const res = await axios.get(target, { timeout: 10000 });
      logger.debug(`[keepAlive] ping ok (${res.status}) -> ${target}`);
    } catch (err) {
      logger.warn(`[keepAlive] ping failed -> ${target}: ${err.message}`);
    }
  });

  logger.info(`[keepAlive] Self-ping scheduled "${env.selfPing.cron}" -> ${target}`);
}

module.exports = { startSelfPing };
