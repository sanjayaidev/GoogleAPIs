require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val && process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.warn(`[env] Warning: ${name} is not set. Some features will not work until it is.`);
  }
  return val;
}

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.BASE_URL,

  supabase: {
    url: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },

  meta: {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    redirectUri: process.env.META_REDIRECT_URI,
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
  },

  selfPing: {
    enabled: (process.env.ENABLE_SELF_PING || 'true') === 'true',
    cron: process.env.SELF_PING_CRON || '*/10 * * * *',
  },
};
