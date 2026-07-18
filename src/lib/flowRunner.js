const { supabase, TABLES } = require('./supabase');
const { getModule } = require('../modules');
const { getConnection } = require('./connections');
const logger = require('./logger');

/**
 * Dot-path lookup, e.g. getPath(obj, "messages.0.id").
 */
function getPath(obj, path) {
  if (obj === undefined || obj === null || !path) return obj;
  return path.split('.').reduce(
    (acc, key) => (acc === undefined || acc === null ? undefined : acc[key]),
    obj
  );
}

const VAR_TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const WHOLE_VAR_TOKEN_RE = /^\{\{\s*([^}]+?)\s*\}\}$/;

/**
 * Resolves a single "<stepIndex>.<field.path>" (or "step<stepIndex>.<...>")
 * token against the running results map, keyed by step order_index.
 */
function resolveToken(token, results) {
  const trimmed = token.trim();
  const dot = trimmed.indexOf('.');
  const stepPart = (dot === -1 ? trimmed : trimmed.slice(0, dot)).replace(/^step/i, '');
  const path = dot === -1 ? '' : trimmed.slice(dot + 1);
  const stepResult = results[stepPart] !== undefined ? results[stepPart] : results[Number(stepPart)];
  if (stepResult === undefined) return undefined;
  return path ? getPath(stepResult, path) : stepResult;
}

/**
 * Placeholder-mapping: a string field can embed one or more `{{stepIndex.field.path}}`
 * tokens (n8n-style) that get resolved against prior steps' outputs.
 *   - A string that is *entirely* one token ("{{1.messages}}") resolves to
 *     the referenced value's native type (object/array/number/etc).
 *   - A string with a token embedded in other text ("Hi {{0.name}}") is
 *     treated as a template and the token is stringified in place.
 * Non-string values pass through untouched (see resolveValue for how
 * objects/arrays are walked).
 */
function interpolateString(str, results) {
  if (typeof str !== 'string' || str.indexOf('{{') === -1) return str;

  const wholeMatch = str.match(WHOLE_VAR_TOKEN_RE);
  if (wholeMatch) return resolveToken(wholeMatch[1], results);

  return str.replace(VAR_TOKEN_RE, (_, token) => {
    const val = resolveToken(token, results);
    if (val === undefined || val === null) return '';
    return typeof val === 'object' ? JSON.stringify(val) : String(val);
  });
}

/**
 * Recursively resolves a single input_map value. Supports:
 *   - the legacy explicit reference object: { fromStep: "<order_index>", field: "messages" }
 *   - `{{stepIndex.field.path}}` placeholder tokens embedded in strings
 *   - arrays/nested objects containing either of the above
 *   - plain static values, returned as-is
 */
function resolveValue(val, results) {
  if (val && typeof val === 'object' && !Array.isArray(val) && 'fromStep' in val) {
    const prior = results[val.fromStep];
    return prior === undefined ? undefined : getPath(prior, val.field);
  }
  if (typeof val === 'string') return interpolateString(val, results);
  if (Array.isArray(val)) return val.map((v) => resolveValue(v, results));
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = resolveValue(v, results);
    return out;
  }
  return val;
}

/**
 * Resolves a step's input_map into concrete values. Each field in
 * input_map is either a static value, a reference object
 * ({ fromStep: "<step order_index>", field: "messages" }), or a string
 * containing one or more `{{stepIndex.field.path}}` placeholder tokens
 * pulling from a previous step's output, stored in `results` keyed by
 * order_index.
 */
function resolveInput(inputMap, results) {
  const resolved = {};
  for (const [key, val] of Object.entries(inputMap || {})) {
    resolved[key] = resolveValue(val, results);
  }
  return resolved;
}

function evaluateCondition(condition, results) {
  if (!condition) return { proceed: true };
  const { field, operator, value, fromStep, skipToStepId } = condition;
  const source = results[fromStep] || {};
  const actual = getPath(source, field);

  const ops = {
    equals: (a, b) => a === b,
    notEquals: (a, b) => a !== b,
    contains: (a, b) => typeof a === 'string' && a.includes(b),
    greaterThan: (a, b) => Number(a) > Number(b),
    lessThan: (a, b) => Number(a) < Number(b),
    exists: (a) => a !== undefined && a !== null,
  };

  const passes = (ops[operator] || (() => true))(actual, value);
  return { proceed: passes, skipToStepId: !passes ? skipToStepId : null };
}

/**
 * Runs a flow's steps in order. No persistent execution engine, no
 * retries, no branching graph - just a for-loop over the steps, each one
 * a single call into a module's action handler. Logs the run to
 * sm_flow_runs for visibility.
 *
 * `triggerPayload`, when provided (a real webhook/poll event, or sample
 * JSON typed into "Test trigger data" for a manual run), is seeded into
 * `results.trigger` so the first (and any later) step can pull from it
 * with `{{trigger.field}}` - e.g. a sheets rowChange trigger's `values`,
 * or a gmail newMail trigger's `messages`.
 */
async function runFlow(flowId, userId, triggerPayload) {
  const { data: steps, error: stepsError } = await supabase
    .from(TABLES.FLOW_STEPS)
    .select('*')
    .eq('flow_id', flowId)
    .order('order_index', { ascending: true });

  if (stepsError) throw stepsError;

  const { data: run, error: runInsertError } = await supabase
    .from(TABLES.FLOW_RUNS)
    .insert({ flow_id: flowId, status: 'running' })
    .select()
    .single();
  if (runInsertError) throw runInsertError;

  const results = { trigger: triggerPayload || {} };
  let skipUntilStepId = null;

  try {
    for (const step of steps) {
      if (skipUntilStepId && step.id !== skipUntilStepId) continue;
      skipUntilStepId = null;

      const { proceed, skipToStepId } = evaluateCondition(step.condition, results);
      if (!proceed) {
        skipUntilStepId = skipToStepId;
        continue;
      }

      const mod = getModule(step.module);
      if (!mod) throw new Error(`Unknown module "${step.module}" in step ${step.id}`);
      const action = mod.actions[step.action];
      if (!action) throw new Error(`Unknown action "${step.action}" in module "${step.module}"`);

      const input = resolveInput(step.input_map, results);
      const parsed = action.inputSchema.parse(input);
      // noAuth modules (e.g. httpRequest) have nothing to look up in
      // sm_connections - step.connection_id is expected to be null/absent
      // for them, and the handler gets connection: null.
      const connection = mod.noAuth ? null : await getConnection(step.connection_id, userId);

      const output = await action.handler({ connection, input: parsed });
      results[step.order_index] = output;
    }

    await supabase
      .from(TABLES.FLOW_RUNS)
      .update({ status: 'success', finished_at: new Date().toISOString(), step_results: results })
      .eq('id', run.id);

    return { runId: run.id, status: 'success', results };
  } catch (err) {
    logger.error({ err, flowId }, '[flowRunner] run failed');
    await supabase
      .from(TABLES.FLOW_RUNS)
      .update({ status: 'failed', finished_at: new Date().toISOString(), step_results: results, error: err.message })
      .eq('id', run.id);

    return { runId: run.id, status: 'failed', error: err.message, results };
  }
}

module.exports = { runFlow, resolveInput, resolveValue, interpolateString, getPath };
