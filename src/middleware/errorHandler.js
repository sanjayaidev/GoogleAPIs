const logger = require('../lib/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error({ err }, 'Unhandled error');

  // Normalize provider (Google/Meta) errors into a consistent shape so
  // callers never see raw upstream error objects.
  const status = err.status || err.statusCode || 500;
  const code = err.code || 'internal_error';
  const message = err.publicMessage || (status < 500 ? err.message : 'Something went wrong.');

  res.status(status).json({ error: code, message });
}

module.exports = errorHandler;
