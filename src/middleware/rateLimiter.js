const rateLimit = require('express-rate-limit');

/**
 * Keyed by the authenticated user id when available (apiKeyAuth must run
 * first), falling back to IP for unauthenticated routes (e.g. oauth,
 * webhooks). This stops one user's runaway flow from starving others and
 * from blowing through your shared Google/Meta quota.
 */
const actionRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests / minute / key - tune per plan later
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : req.ip),
  message: { error: 'rate_limited', message: 'Too many requests, slow down.' },
});

const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { actionRateLimiter, webhookRateLimiter };
