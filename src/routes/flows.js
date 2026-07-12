const express = require('express');
const { supabase, TABLES } = require('../lib/supabase');
const { runFlow } = require('../lib/flowRunner');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const { actionRateLimiter } = require('../middleware/rateLimiter');
const logger = require('../lib/logger');

const router = express.Router();
router.use(apiKeyAuth);

// GET /flows - list this user's flows
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from(TABLES.FLOWS)
      .select('*, sm_flow_steps(*)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ flows: data });
  } catch (err) {
    next(err);
  }
});

// POST /flows { name, triggerType, triggerConfig, steps: [{ module, action, connectionId, inputMap, condition }] }
router.post('/', express.json(), async (req, res, next) => {
  try {
    const { name, triggerType = 'manual', triggerConfig = {}, steps = [] } = req.body || {};
    if (!name || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'invalid_input', message: 'name and at least one step required' });
    }

    const { data: flow, error: flowError } = await supabase
      .from(TABLES.FLOWS)
      .insert({ user_id: req.user.id, name, trigger_type: triggerType, trigger_config: triggerConfig })
      .select()
      .single();
    if (flowError) throw flowError;

    const stepRows = steps.map((s, i) => ({
      flow_id: flow.id,
      order_index: i,
      module: s.module,
      action: s.action,
      connection_id: s.connectionId,
      input_map: s.inputMap || {},
      condition: s.condition || null,
    }));

    const { error: stepsError } = await supabase.from(TABLES.FLOW_STEPS).insert(stepRows);
    if (stepsError) throw stepsError;

    res.status(201).json({ flow });
  } catch (err) {
    logger.error({ err }, '[flows] create failed');
    next(err);
  }
});

// POST /flows/:id/run - executes the flow's steps in order right now (manual trigger)
router.post('/:id/run', actionRateLimiter, async (req, res, next) => {
  try {
    const { data: flow, error } = await supabase
      .from(TABLES.FLOWS)
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!flow) return res.status(404).json({ error: 'flow_not_found' });

    const result = await runFlow(flow.id, req.user.id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, '[flows] run failed');
    next(err);
  }
});

// DELETE /flows/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from(TABLES.FLOWS).delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
