const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const env = require('./src/config/env');
const logger = require('./src/lib/logger');
const { startSelfPing } = require('./src/lib/keepAlive');

const healthRoute = require('./src/routes/health');
const oauthRoutes = require('./src/routes/oauth');
const webhookRoutes = require('./src/routes/webhooks');
const actionRouter = require('./src/routes/actionRouter');
const authRoutes = require('./src/routes/auth');
const connectionsRoutes = require('./src/routes/connections');
const flowsRoutes = require('./src/routes/flows');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors()); // tighten to specific origins once you have a frontend domain
app.use(pinoHttp({ logger }));

// Webhooks need raw body for signature verification on the /meta route,
// so JSON parsing for everything else is applied after mounting webhooks.
app.use('/webhooks', webhookRoutes);

app.use(express.json());

app.use('/health', healthRoute);
app.use('/oauth', oauthRoutes);
app.use('/api', actionRouter);
app.use('/auth', authRoutes);
app.use('/connections', connectionsRoutes);
app.use('/flows', flowsRoutes);

// Dashboard UI - same app, same deploy. Static files in /public.
app.use(express.static(require('path').join(__dirname, 'public')));

app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).sendFile(require('path').join(__dirname, 'public', 'index.html'));
  }
  res.status(404).json({ error: 'not_found' });
});

app.use(errorHandler);

app.listen(env.port, () => {
  logger.info(`sm-server listening on port ${env.port} (${env.nodeEnv})`);
  startSelfPing();
});
