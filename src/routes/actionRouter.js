const express = require('express');
const { getModule, listModules } = require('../modules');
const { getConnection } = require('../lib/connections');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const { actionRateLimiter } = require('../middleware/rateLimiter');
const logger = require('../lib/logger');

const router = express.Router();

router.use(apiKeyAuth, actionRateLimiter);

// GET /api - list available modules/actions (handy for building the UI dynamically)
router.get('/', (req, res) => {
  res.json({ modules: listModules() });
});

// POST /api/:module/:action
// Body: { connectionId: "...", input: { ... } }
router.post('/:module/:action', async (req, res, next) => {
  const { module: moduleName, action: actionName } = req.params;
  const { connectionId, input = {} } = req.body || {};

  try {
    const mod = getModule(moduleName);
    if (!mod) {
      return res.status(404).json({ error: 'unknown_module', message: `No module named "${moduleName}"` });
    }

    const action = mod.actions[actionName];
    if (!action) {
      return res.status(404).json({
        error: 'unknown_action',
        message: `Module "${moduleName}" has no action "${actionName}"`,
        availableActions: Object.keys(mod.actions),
      });
    }

    if (!connectionId) {
      return res.status(400).json({ error: 'missing_connection_id', message: 'Provide connectionId of a connected account' });
    }

    // Validate input against the module's own zod schema - reject before
    // ever calling the upstream provider.
    const parsed = action.inputSchema.safeParse(input);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    }

    const connection = await getConnection(connectionId, req.user.id);

    if (connection.provider !== mod.provider) {
      return res.status(400).json({
        error: 'provider_mismatch',
        message: `Module "${moduleName}" requires a "${mod.provider}" connection, but connectionId points to a "${connection.provider}" one`,
      });
    }

    // Connections are scoped to the module they were OAuth-connected for
    // (see migration 002 + src/routes/oauth.js). A connection with no
    // `module` value is a legacy row from before this scoping existed -
    // allow it through on provider match alone so old data keeps working.
    if (connection.module && connection.module !== moduleName) {
      return res.status(400).json({
        error: 'module_mismatch',
        message: `This account was connected for "${connection.module}", not "${moduleName}". Connect a separate account for ${moduleName} from the module bar.`,
      });
    }

    const output = await action.handler({ connection, input: parsed.data });
    res.json({ success: true, output });
  } catch (err) {
    logger.error({ err, moduleName, actionName }, '[actionRouter] action failed');
    next(err);
  }
});

module.exports = router;
