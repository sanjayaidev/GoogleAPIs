const express = require('express');
const { supabase, TABLES } = require('../lib/supabase');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const logger = require('../lib/logger');

const router = express.Router();
router.use(apiKeyAuth);

// GET /connections - list the caller's connected accounts (no tokens returned)
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from(TABLES.CONNECTIONS)
      .select('id, provider, module, account_label, status, scopes, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ connections: data });
  } catch (err) {
    logger.error({ err }, '[connections] list failed');
    next(err);
  }
});

// DELETE /connections/:id - revoke/remove a connection
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from(TABLES.CONNECTIONS)
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[connections] delete failed');
    next(err);
  }
});

module.exports = router;
