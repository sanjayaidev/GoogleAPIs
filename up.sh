#!/usr/bin/env bash
# Applies the placeholder-mapping (n8n-style {{stepIndex.field}}) feature
# by writing the finished files directly - avoids any diff/patch parsing.
# Run this from the repo root (GoogleAPIs/).
set -e

mkdir -p "$(dirname "src/lib/flowRunner.js")"
cat > src/lib/flowRunner.js << 'PLACEHOLDER_MAPPING_EOF'
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
 */
async function runFlow(flowId, userId) {
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

  const results = {};
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
      const connection = await getConnection(step.connection_id, userId);

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
PLACEHOLDER_MAPPING_EOF
echo "wrote src/lib/flowRunner.js"

mkdir -p "$(dirname "public/js/flow-builder.js")"
cat > public/js/flow-builder.js << 'PLACEHOLDER_MAPPING_EOF'
// Node-canvas flow builder. Talks to the exact same backend as the classic
// dashboard (public/js/app.js) - /connections, /oauth/google/start,
// /flows - so anything built here is a real, runnable flow, not a mockup.
//
// Simplification (matches the linear flowRunner - see src/lib/flowRunner.js):
// execution order is a single chain. The canvas lets you draw and remove
// connectors freely (n8n-style drag from an output socket to an input
// socket), but under the hood we still serialize to the backend's linear
// `steps` array by walking the chain from the trigger node through its
// connectors. Real branching isn't implemented server-side yet, so this
// canvas enforces one outgoing + one incoming connector per node.

const API = '';
let apiKey = localStorage.getItem('sm_api_key') || null;
let modulesCache = [];       // [{name, provider, actions, triggers}]
let connectionsCache = [];   // [{id, provider, module, account_label, status}]
let flowsCache = [];
let canvasNodes = [];        // [{id, module, role, typeId, connectionId, config, x, y}]
let edges = [];              // [{from: nodeId, to: nodeId}]
let selectedNodeId = null;
let lastSavedFlowId = null;
let nodeSeq = 1;

// canvas view state
let zoom = 1;
let panX = 40;
let panY = 40;
const ZOOM_MIN = 0.35, ZOOM_MAX = 1.75;

const NODE_W = 190;
const NODE_H = 64; // approximate rendered height, used for socket + edge geometry

function headers() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
}

function showToast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- bootstrap ----------

async function init() {
  wireStaticButtons();
  if (!apiKey) {
    document.getElementById('keyPill').textContent = 'no API key — log in on the classic dashboard';
    showToast('No API key found. Log in or paste a key on the classic dashboard first.', 'error');
    return;
  }
  document.getElementById('keyPill').textContent = apiKey.slice(0, 14) + '...';
  await loadModules();
  await loadConnections();
  await loadFlows();
  renderModuleBar();
  applyCanvasTransform();
  renderCanvas();
}

async function loadModules() {
  try {
    const res = await fetch(API + '/api', { headers: headers() });
    const data = await res.json();
    modulesCache = res.ok ? (data.modules || []) : [];
    if (!res.ok) showToast('Could not load modules (' + (data.error || res.status) + ')', 'error');
  } catch (e) { showToast('Network error loading modules: ' + e.message, 'error'); }
}

async function loadConnections() {
  try {
    const res = await fetch(API + '/connections', { headers: headers() });
    const data = await res.json();
    connectionsCache = res.ok ? (data.connections || []) : [];
    if (!res.ok) showToast('Could not load connections (' + (data.error || res.status) + ')', 'error');
  } catch (e) { showToast('Network error loading connections: ' + e.message, 'error'); }
}

async function loadFlows() {
  try {
    const res = await fetch(API + '/flows', { headers: headers() });
    const data = await res.json();
    flowsCache = res.ok ? (data.flows || []) : [];
    const sel = document.getElementById('flowSelect');
    sel.innerHTML = '<option value="">My saved flows…</option>' +
      flowsCache.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
  } catch (e) { /* non-fatal */ }
}

// ---------- module bar ----------

function providerFor(moduleName) {
  const mod = modulesCache.find(m => m.name === moduleName);
  return mod ? mod.provider : 'google';
}

// A connection belongs to a module only if it was connected for that exact
// module. Legacy rows saved before per-module scoping existed have no
// `module` value - fall back to provider match for those so old data still
// works, but a module-scoped connection never leaks into another module's
// list (this is the fix for "shows one account for all" modules).
function connectionsForModule(moduleName) {
  const provider = providerFor(moduleName);
  return connectionsCache.filter(c =>
    c.status === 'active' &&
    c.provider === provider &&
    (c.module ? c.module === moduleName : true)
  );
}

function renderModuleBar() {
  const el = document.getElementById('moduleBar');
  el.innerHTML = MODULE_ORDER.map(name => {
    const def = NODE_DEFS[name];
    if (!def) return '';
    const conns = connectionsForModule(name);
    const connected = conns.length > 0;
    return `
      <div class="module-card" data-add-node="${name}">
        <div class="icon">${def.icon}</div>
        <div class="name">${def.label}</div>
        <button class="connect-btn" data-connect-module="${name}" type="button">${connected ? '+ add another' : 'Connect'}</button>
        <div class="conn-status ${connected ? 'on' : ''}">
          ${connected ? conns.map(c => `
            <span class="acc-chip">${c.account_label}
              <button type="button" class="acc-chip-x" data-disconnect-conn="${c.id}" title="Disconnect this account">×</button>
            </span>`).join('') : 'Not connected'}
        </div>
        <div class="add-hint">click card to add node →</div>
      </div>`;
  }).join('');
}

function wireModuleBarDelegation() {
  const el = document.getElementById('moduleBar');
  el.addEventListener('click', (e) => {
    const connectBtn = e.target.closest('[data-connect-module]');
    if (connectBtn) {
      e.stopPropagation();
      connectModule(connectBtn.dataset.connectModule);
      return;
    }
    const disconnectBtn = e.target.closest('[data-disconnect-conn]');
    if (disconnectBtn) {
      e.stopPropagation();
      disconnectConnection(disconnectBtn.dataset.disconnectConn);
      return;
    }
    const card = e.target.closest('[data-add-node]');
    if (card) addNode(card.dataset.addNode);
  });
}

async function connectModule(moduleName) {
  try {
    const res = await fetch(`${API}/oauth/google/start?module=${moduleName}&returnTo=flow-builder`, { headers: headers() });
    const data = await res.json();
    if (data.authUrl) location.href = data.authUrl;
    else showToast(data.message || 'Could not start connection', 'error');
  } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

async function disconnectConnection(connectionId) {
  if (!confirm('Disconnect this account? Any node using it will need a new account picked.')) return;
  try {
    const res = await fetch(`${API}/connections/${connectionId}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.message || 'Could not disconnect', 'error');
      return;
    }
    // Clear this connection off any node that was using it.
    canvasNodes.forEach(n => { if (n.connectionId === connectionId) n.connectionId = ''; });
    await loadConnections();
    renderModuleBar();
    renderCanvas();
    renderProps();
    showToast('Account disconnected.', 'ok');
  } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

// ---------- canvas view: zoom + pan ----------

function applyCanvasTransform() {
  const scroll = document.getElementById('canvasScroll');
  scroll.style.setProperty('--zoom', zoom);
  scroll.style.setProperty('--panx', panX + 'px');
  scroll.style.setProperty('--pany', panY + 'px');
  document.getElementById('zoomPct').textContent = Math.round(zoom * 100) + '%';
}

function setZoom(newZoom, centerClientX, centerClientY) {
  newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  const scroll = document.getElementById('canvasScroll');
  const rect = scroll.getBoundingClientRect();
  const cx = centerClientX !== undefined ? centerClientX - rect.left : rect.width / 2;
  const cy = centerClientY !== undefined ? centerClientY - rect.top : rect.height / 2;
  // keep the world point under the cursor fixed while zooming
  const worldX = (cx - panX) / zoom;
  const worldY = (cy - panY) / zoom;
  zoom = newZoom;
  panX = cx - worldX * zoom;
  panY = cy - worldY * zoom;
  applyCanvasTransform();
}

function resetZoom() {
  zoom = 1; panX = 40; panY = 40;
  applyCanvasTransform();
}

function wireZoomPan() {
  const scroll = document.getElementById('canvasScroll');

  scroll.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom(zoom * (1 + delta), e.clientX, e.clientY);
  }, { passive: false });

  let panning = null; // { startX, startY, panX0, panY0 }
  scroll.addEventListener('mousedown', (e) => {
    // only pan when clicking empty canvas background, not a node/socket/edge
    if (e.target.closest('.node-box') || e.target.closest('svg')) return;
    panning = { startX: e.clientX, startY: e.clientY, panX0: panX, panY0: panY };
    scroll.classList.add('panning');
  });
  document.addEventListener('mousemove', (e) => {
    if (!panning) return;
    panX = panning.panX0 + (e.clientX - panning.startX);
    panY = panning.panY0 + (e.clientY - panning.startY);
    applyCanvasTransform();
  });
  document.addEventListener('mouseup', () => { panning = null; scroll.classList.remove('panning'); });

  document.getElementById('zoomInBtn').addEventListener('click', () => setZoom(zoom * 1.2));
  document.getElementById('zoomOutBtn').addEventListener('click', () => setZoom(zoom / 1.2));
  document.getElementById('zoomResetBtn').addEventListener('click', resetZoom);
}

// ---------- canvas: nodes + edges ----------

function addNode(moduleName, opts) {
  opts = opts || {};
  const def = NODE_DEFS[moduleName];
  if (!def) return;
  // "first node" here means "no trigger exists yet", not "canvas is empty" -
  // if the trigger node got deleted, the next node added should be able to
  // become the trigger again even if other action nodes remain.
  const isFirst = !canvasNodes.some(n => n.role === 'trigger');
  const firstTrigger = def.triggers[0];
  const firstAction = def.actions[0];
  if (isFirst && !firstTrigger) {
    showToast(`${def.label} has no trigger defined yet, so it can't be the first node.`, 'error');
    return;
  }
  const conns = connectionsForModule(moduleName);

  // place near the selected node (if any) so a chain reads left-to-right,
  // otherwise stagger from the last node, otherwise start near the origin.
  const fromNode = !isFirst ? canvasNodes.find(n => n.id === selectedNodeId) : null;
  let x, y;
  if (opts.x !== undefined) { x = opts.x; y = opts.y; }
  else if (fromNode) { x = fromNode.x + 260; y = fromNode.y; }
  else if (canvasNodes.length) {
    const last = canvasNodes[canvasNodes.length - 1];
    x = last.x + 260; y = last.y;
  } else { x = 60; y = 60; }

  const node = {
    id: 'n' + (nodeSeq++),
    module: moduleName,
    role: isFirst ? 'trigger' : 'action',
    typeId: isFirst ? firstTrigger.id : (firstAction ? firstAction.id : ''),
    connectionId: conns[0] ? conns[0].id : '',
    config: {},
    x, y,
  };
  canvasNodes.push(node);

  // Auto-wire from the previously selected node if it has a free outgoing
  // slot - mirrors n8n's "+ " on a node auto-connecting the new node.
  if (fromNode && !edges.some(e => e.from === fromNode.id)) {
    edges.push({ from: fromNode.id, to: node.id });
  }

  selectedNodeId = node.id;
  renderCanvas();
  renderNodeSide();
  renderProps();
}

function removeNode(id) {
  canvasNodes = canvasNodes.filter(n => n.id !== id);
  edges = edges.filter(e => e.from !== id && e.to !== id);
  if (selectedNodeId === id) selectedNodeId = null;
  renderCanvas();
  renderNodeSide();
  renderProps();
}

function connectNodes(fromId, toId) {
  if (fromId === toId) return;
  const fromNode = canvasNodes.find(n => n.id === fromId);
  const toNode = canvasNodes.find(n => n.id === toId);
  if (!fromNode || !toNode) return;
  if (toNode.role === 'trigger') {
    showToast("Can't connect into a trigger node - triggers only have an output.", 'error');
    return;
  }
  // enforce single linear chain: at most one outgoing edge per node, one
  // incoming edge per node (matches the backend's ordered steps array)
  edges = edges.filter(e => e.from !== fromId && e.to !== toId);
  edges.push({ from: fromId, to: toId });
  renderCanvas();
}

function disconnectEdge(fromId, toId) {
  edges = edges.filter(e => !(e.from === fromId && e.to === toId));
  renderCanvas();
}

function nodeTypeDef(node) {
  const def = NODE_DEFS[node.module];
  if (!def) return null;
  const list = node.role === 'trigger' ? def.triggers : def.actions;
  return list.find(t => t.id === node.typeId) || null;
}

function renderCanvas() {
  const canvas = document.getElementById('canvas');
  const empty = document.getElementById('canvasEmpty');
  empty.style.display = canvasNodes.length ? 'none' : 'block';

  canvas.innerHTML = canvasNodes.map((n) => {
    const def = NODE_DEFS[n.module];
    const typeDef = nodeTypeDef(n);
    const conns = connectionsForModule(n.module);
    const conn = conns.find(c => c.id === n.connectionId);
    const hasOut = edges.some(e => e.from === n.id);
    const hasIn = edges.some(e => e.to === n.id);
    return `
      <div class="node-box ${n.id === selectedNodeId ? 'selected' : ''}" data-node-id="${n.id}" style="left:${n.x}px; top:${n.y}px;">
        <div class="nb-role">${n.role}</div>
        <button class="nb-remove" type="button" data-remove-node="${n.id}" title="Remove node">✕</button>
        <div class="nb-head"><span class="nb-icon">${def.icon}</span>${def.label}</div>
        <div class="nb-sub">${typeDef ? typeDef.label : 'choose an operation'}${conn ? ' · ' + conn.account_label : (n.connectionId === '' && conns.length === 0 ? ' · no account' : '')}</div>
        ${n.role !== 'trigger' ? `<div class="nb-socket in ${hasIn ? 'filled' : ''}" data-socket="in" data-node-id="${n.id}" title="Drag a connector here"></div>` : ''}
        <div class="nb-socket out ${hasOut ? 'filled' : ''}" data-socket="out" data-node-id="${n.id}" title="Drag to another node's input to connect"></div>
      </div>`;
  }).join('');

  drawEdges();
}

// socket position in world (unscaled canvas) coordinates
function socketPos(node, which) {
  const y = node.y + NODE_H / 2;
  const x = which === 'out' ? node.x + NODE_W : node.x;
  return { x, y };
}

function edgePathD(p1, p2) {
  const mx = (p1.x + p2.x) / 2;
  return `M ${p1.x} ${p1.y} C ${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x} ${p2.y}`;
}

function drawEdges() {
  const svg = document.getElementById('edgesSvg');
  let html = '';
  edges.forEach(edge => {
    const a = canvasNodes.find(n => n.id === edge.from);
    const b = canvasNodes.find(n => n.id === edge.to);
    if (!a || !b) return;
    const p1 = socketPos(a, 'out');
    const p2 = socketPos(b, 'in');
    const d = edgePathD(p1, p2);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    html += `<path class="edge-hit" d="${d}" data-edge-from="${edge.from}" data-edge-to="${edge.to}"></path>`;
    html += `<path class="edge-line" d="${d}"></path>`;
    html += `<g class="edge-del-btn" data-edge-from="${edge.from}" data-edge-to="${edge.to}">
      <circle cx="${mx}" cy="${my}" r="9"></circle>
      <text x="${mx}" y="${my + 1}">✕</text>
    </g>`;
  });
  if (dragEdgeState) {
    html += `<path class="edge-drawing" d="${edgePathD(dragEdgeState.from, dragEdgeState.current)}"></path>`;
  }
  svg.innerHTML = html;
}

// ---------- canvas: node drag, socket-drag connect, selection ----------

let dragEdgeState = null; // { fromId, from: {x,y}, current: {x,y} }

function clientToWorld(clientX, clientY) {
  const scroll = document.getElementById('canvasScroll');
  const rect = scroll.getBoundingClientRect();
  return {
    x: (clientX - rect.left - panX) / zoom,
    y: (clientY - rect.top - panY) / zoom,
  };
}

function wireCanvasDragAndSelect() {
  const canvas = document.getElementById('canvas');
  let dragging = null; // { id, offsetX, offsetY } in world units

  canvas.addEventListener('mousedown', (e) => {
    const removeBtn = e.target.closest('[data-remove-node]');
    if (removeBtn) { removeNode(removeBtn.dataset.removeNode); return; }

    const socket = e.target.closest('.nb-socket');
    if (socket && socket.dataset.socket === 'out') {
      e.stopPropagation();
      const node = canvasNodes.find(n => n.id === socket.dataset.nodeId);
      if (!node) return;
      const from = socketPos(node, 'out');
      dragEdgeState = { fromId: node.id, from, current: clientToWorld(e.clientX, e.clientY) };
      return;
    }

    const box = e.target.closest('.node-box');
    if (!box) return;
    const id = box.dataset.nodeId;
    selectedNodeId = id;
    renderCanvas();
    renderNodeSide();
    renderProps();

    const node = canvasNodes.find(n => n.id === id);
    const world = clientToWorld(e.clientX, e.clientY);
    dragging = { id, offsetX: world.x - node.x, offsetY: world.y - node.y };
    box.style.cursor = 'grabbing';
  });

  document.getElementById('edgesSvg').addEventListener('click', (e) => {
    const del = e.target.closest('[data-edge-from]');
    if (del) disconnectEdge(del.dataset.edgeFrom, del.dataset.edgeTo);
  });

  document.addEventListener('mousemove', (e) => {
    if (dragEdgeState) {
      dragEdgeState.current = clientToWorld(e.clientX, e.clientY);
      drawEdges();
      // highlight a valid drop target
      document.querySelectorAll('.node-box.drag-target').forEach(el => el.classList.remove('drag-target'));
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const overSocket = hit ? hit.closest('.nb-socket[data-socket="in"]') : null;
      if (overSocket) {
        const box = canvas.querySelector(`[data-node-id="${overSocket.dataset.nodeId}"]`);
        if (box) box.classList.add('drag-target');
      }
      return;
    }
    if (!dragging) return;
    const node = canvasNodes.find(n => n.id === dragging.id);
    if (!node) return;
    const world = clientToWorld(e.clientX, e.clientY);
    node.x = Math.max(0, world.x - dragging.offsetX);
    node.y = Math.max(0, world.y - dragging.offsetY);
    const box = canvas.querySelector(`[data-node-id="${node.id}"]`);
    if (box) { box.style.left = node.x + 'px'; box.style.top = node.y + 'px'; }
    drawEdges();
  });

  document.addEventListener('mouseup', (e) => {
    if (dragEdgeState) {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const target = hit ? hit.closest('.nb-socket[data-socket="in"]') : null;
      document.querySelectorAll('.node-box.drag-target').forEach(el => el.classList.remove('drag-target'));
      if (target) connectNodes(dragEdgeState.fromId, target.dataset.nodeId);
      dragEdgeState = null;
      drawEdges();
    }
    dragging = null;
  });
}

// ---------- left panel: triggers/actions for the selected node's module ----------

function renderNodeSide() {
  const side = document.getElementById('nodeSide');
  const node = canvasNodes.find(n => n.id === selectedNodeId);
  if (!node) {
    side.innerHTML = '<div class="node-side-empty" id="nodeSideEmpty">Select a node on the canvas to see its triggers and actions here.</div>';
    return;
  }
  const def = NODE_DEFS[node.module];
  const isFirstNode = node.role === 'trigger';

  const triggerItems = def.triggers.map(t => `
    <div class="op-item trigger ${node.role === 'trigger' && node.typeId === t.id ? 'selected' : ''} ${isFirstNode ? '' : 'disabled'}"
         data-op="trigger:${t.id}" style="${isFirstNode ? '' : 'opacity:.4; pointer-events:none;'}">
      <span class="op-marker"></span>${t.label}
    </div>`).join('') || '<div class="node-side-empty">No triggers for this module yet.</div>';

  const actionItems = def.actions.map(a => `
    <div class="op-item ${node.role === 'action' && node.typeId === a.id ? 'selected' : ''} ${isFirstNode ? 'disabled' : ''}"
         data-op="action:${a.id}" style="${isFirstNode ? 'opacity:.4; pointer-events:none;' : ''}">
      <span class="op-marker"></span>${a.label}
    </div>`).join('');

  side.innerHTML = `
    <h2>${def.icon} ${def.label}</h2>
    <div class="group-label">Triggers ${isFirstNode ? '' : '(only available on the first node)'}</div>
    ${triggerItems}
    <div class="group-label">Actions ${isFirstNode ? '(add another node first)' : ''}</div>
    ${actionItems}
  `;
}

function wireNodeSideDelegation() {
  const side = document.getElementById('nodeSide');
  side.addEventListener('click', (e) => {
    const item = e.target.closest('[data-op]');
    if (!item) return;
    const node = canvasNodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    const [role, typeId] = item.dataset.op.split(':');
    if ((role === 'trigger') !== (node.role === 'trigger')) return; // guarded by disabled styling too
    node.typeId = typeId;
    node.config = {};
    renderCanvas();
    renderNodeSide();
    renderProps();
  });
}

// ---------- right panel: Node Properties ----------

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function parseFieldValue(f, raw) {
  if (f.type === 'number') return raw === '' ? undefined : Number(raw);
  if (f.parse === 'csv') return raw.split(',').map(s => s.trim()).filter(Boolean);
  if (f.parse === 'json') { try { return JSON.parse(raw); } catch { return raw; } }
  return raw;
}

function renderProps() {
  const panel = document.getElementById('propsPanel');
  const node = canvasNodes.find(n => n.id === selectedNodeId);
  if (!node) {
    panel.innerHTML = '<h2>Node Properties</h2><div class="props-empty" id="propsEmpty">Nothing selected.</div>';
    return;
  }
  const typeDef = nodeTypeDef(node);
  const conns = connectionsForModule(node.module);

  const connRow = `
    <div class="conn-select-row">
      <label style="display:block; font-size:12px; font-weight:600; margin-bottom:6px;">Account for this node</label>
      <select id="propConnSelect">
        <option value="">choose account…</option>
        ${conns.map(c => `<option value="${c.id}" ${c.id === node.connectionId ? 'selected' : ''}>${c.account_label}</option>`).join('')}
      </select>
      <div style="margin-top:8px;">
        <button type="button" class="tbtn" id="propConnectMoreBtn" data-connect-module="${node.module}" style="font-size:11px; padding:5px 10px;">+ connect another account</button>
        ${node.connectionId ? `<button type="button" class="tbtn" id="propDisconnectBtn" data-disconnect-conn="${node.connectionId}" style="font-size:11px; padding:5px 10px; color:var(--danger); border-color:var(--danger); margin-left:6px;">disconnect this one</button>` : ''}
      </div>
      ${conns.length === 0 ? `<div class="hint">No account connected for ${NODE_DEFS[node.module].label} yet — connect one above.</div>` : ''}
    </div>`;

  const upstreamSteps = node.role === 'trigger' ? [] : getUpstreamStepsFor(node);

  const fields = typeDef ? typeDef.fields : [];
  const fieldsHtml = fields.map(f => {
    const val = node.config[f.name] ?? '';
    if (f.type === 'resource') {
      const placeholder = f.placeholder || `Select ${f.label}`;
      return `<div class="pfield" data-resource-field="${f.name}" data-resource-type="${f.resourceType}" data-depends-on="${f.dependsOn || ''}">
        <label>${f.label}</label>
        <select data-prop-field="${f.name}" class="resource-select">
          <option value="">${placeholder}</option>
        </select>
        <button type="button" class="tbtn load-resources-btn" style="font-size:11px; padding:4px 8px; margin-top:6px;">↻ Load options</button>
      </div>`;
    }
    if (f.type === 'select') {
      return `<div class="pfield"><label>${f.label}</label><select data-prop-field="${f.name}">
        <option value="">${f.placeholder || 'Select...'}</option>
        ${(f.options || []).map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('')}
      </select></div>`;
    }
    if (f.type === 'textarea') {
      return `<div class="pfield">
        <label>${f.label}</label>
        <div class="pfield-input-row">
          <textarea data-prop-field="${f.name}" placeholder="${f.placeholder || ''}">${val}</textarea>
          ${varPickerHtml(f.name, upstreamSteps)}
        </div>
      </div>`;
    }
    if (f.type === 'checkbox') {
      return `<div class="pfield"><label><input type="checkbox" data-prop-field="${f.name}" ${val ? 'checked' : ''} /> ${f.label}</label></div>`;
    }
    if (f.type === 'checkboxGroup') {
      // Inclusive multi-select (e.g. sheets "Trigger on: added / updated") -
      // pick one or both, stored as an array on node.config[f.name].
      const current = Array.isArray(node.config[f.name]) ? node.config[f.name] : (f.default ? [...f.default] : []);
      node.config[f.name] = current; // seed so it's included even if untouched
      return `<div class="pfield" data-checkbox-group="${f.name}">
        <label>${f.label}</label>
        ${(f.options || []).map(o => `
          <label style="display:flex; align-items:center; gap:6px; font-weight:400; margin-top:4px;">
            <input type="checkbox" data-prop-field="${f.name}" data-checkbox-value="${o.value}" ${current.includes(o.value) ? 'checked' : ''} />
            ${o.label}
          </label>`).join('')}
      </div>`;
    }
    return `<div class="pfield">
      <label>${f.label}</label>
      <div class="pfield-input-row">
        <input type="${f.type === 'number' ? 'number' : 'text'}" data-prop-field="${f.name}" placeholder="${f.placeholder || ''}" value="${val}" />
        ${varPickerHtml(f.name, upstreamSteps)}
      </div>
    </div>`;
  }).join('') || '<div class="props-empty">No inputs needed for this operation.</div>';

  const mappingHint = upstreamSteps.length
    ? `<div class="hint" style="margin:-6px 0 14px;">🔗 Click the link icon next to a field to map in a value from an earlier step. It inserts <code>{{stepIndex.field}}</code> with "field" pre-selected — type the actual field name (or path, e.g. <code>messages.0.from</code>) from that step's output over it. You can also mix it into surrounding text, e.g. <code>Hello {{0.name}}</code>.</div>`
    : '';

  panel.innerHTML = `
    <h2>Node Properties</h2>
    ${connRow}
    <div class="group-label" style="margin:0 0 10px; padding:0;">${typeDef ? typeDef.label : 'Choose an operation'}</div>
    ${mappingHint}
    ${fieldsHtml}
  `;
}

function wirePropsDelegation() {
  const panel = document.getElementById('propsPanel');
  panel.addEventListener('click', (e) => {
    const connectBtn = e.target.closest('[data-connect-module]');
    if (connectBtn) { connectModule(connectBtn.dataset.connectModule); return; }
    const disconnectBtn = e.target.closest('[data-disconnect-conn]');
    if (disconnectBtn) { disconnectConnection(disconnectBtn.dataset.disconnectConn); return; }
    
    // Handle "Load options" button for resource fields
    const loadBtn = e.target.closest('.load-resources-btn');
    if (loadBtn) {
      const pfield = loadBtn.closest('.pfield');
      const select = pfield.querySelector('.resource-select');
      const resourceType = pfield.dataset.resourceType;
      const dependsOn = pfield.dataset.dependsOn;
      const fieldName = pfield.dataset.resourceField;
      
      loadResources(select, resourceType, dependsOn, fieldName);
      return;
    }

    // "Insert from earlier step" picker: toggle button opens/closes its menu.
    const varBtn = e.target.closest('.var-btn');
    if (varBtn) {
      const picker = varBtn.closest('.var-picker');
      const wasOpen = picker.classList.contains('open');
      panel.querySelectorAll('.var-picker.open').forEach(p => p.classList.remove('open'));
      if (!wasOpen) picker.classList.add('open');
      return;
    }
    // Clicking a menu item inserts `{{stepIndex.field}}` into the field it belongs to.
    const varItem = e.target.closest('.var-menu-item');
    if (varItem) {
      const picker = varItem.closest('.var-picker');
      picker.classList.remove('open');
      const targetEl = panel.querySelector(`[data-prop-field="${picker.dataset.varFor}"]`);
      if (targetEl) insertVariableToken(targetEl, varItem.dataset.varToken);
      return;
    }
    // Any other click inside the panel closes open picker menus.
    panel.querySelectorAll('.var-picker.open').forEach(p => p.classList.remove('open'));
  });
  panel.addEventListener('change', (e) => {
    const node = canvasNodes.find(n => n.id === selectedNodeId);
    if (!node) return;

    if (e.target.id === 'propConnSelect') {
      node.connectionId = e.target.value;
      renderCanvas();
      renderProps();
      return;
    }
    const fieldEl = e.target.closest('[data-prop-field]');
    if (!fieldEl) return;
    const typeDef = nodeTypeDef(node);
    const f = (typeDef ? typeDef.fields : []).find(x => x.name === fieldEl.dataset.propField);
    if (!f) return;

    if (f.type === 'checkboxGroup') {
      // Collect every checked box sharing this field name into an array -
      // this is what makes "one or both" possible instead of a radio choice.
      const boxes = panel.querySelectorAll(`[data-prop-field="${f.name}"][data-checkbox-value]`);
      node.config[f.name] = Array.from(boxes).filter(b => b.checked).map(b => b.dataset.checkboxValue);
      return;
    }

    const raw = f.type === 'checkbox' ? fieldEl.checked : fieldEl.value;
    node.config[f.name] = raw;
    
    // If this is a resource field that other fields depend on, trigger reload of dependent fields
    // (dependsOn can be a single field name or a comma-separated list, e.g. "accountId,locationId").
    if (f.type === 'resource') {
      const dependsOnList = (fld) => (fld.dependsOn || '').split(',').map(s => s.trim()).filter(Boolean);
      const dependentFields = (typeDef ? typeDef.fields : []).filter(field => dependsOnList(field).includes(f.name));
      dependentFields.forEach(depField => {
        const depPfield = panel.querySelector(`.pfield[data-resource-field="${depField.name}"]`);
        if (depPfield) {
          const depSelect = depPfield.querySelector('.resource-select');
          loadResources(depSelect, depField.resourceType, depField.dependsOn, depField.name);
        }
      });
    }
  });
  // live-update text/textarea as you type, not just on blur/change
  panel.addEventListener('input', (e) => {
    const node = canvasNodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    const fieldEl = e.target.closest('[data-prop-field]');
    if (!fieldEl || fieldEl.tagName === 'SELECT') return;
    const typeDef = nodeTypeDef(node);
    const f = (typeDef ? typeDef.fields : []).find(x => x.name === fieldEl.dataset.propField);
    if (!f) return;
    node.config[f.name] = fieldEl.type === 'checkbox' ? fieldEl.checked : fieldEl.value;
  });
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.var-picker')) {
      panel.querySelectorAll('.var-picker.open').forEach(p => p.classList.remove('open'));
    }
  });
}

// Load resources from API for dropdown population
async function loadResources(selectEl, resourceType, dependsOnField, currentFieldName) {
  const node = canvasNodes.find(n => n.id === selectedNodeId);
  if (!node || !node.connectionId) {
    showToast('Please select an account first', 'error');
    return;
  }
  
  const originalText = selectEl.innerHTML;
  selectEl.innerHTML = '<option value="">Loading...</option>';
  selectEl.disabled = true;
  
  // dependsOn can be a single field name or a comma-separated list (e.g.
  // "accountId,locationId" for a review dropdown that needs both parents).
  const depNames = (dependsOnField || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const dep of depNames) {
    if (!node.config[dep]) {
      showToast(`Please select ${dep} first`, 'error');
      selectEl.innerHTML = originalText;
      selectEl.disabled = false;
      return;
    }
  }

  try {
    let actionName = '';
    let inputPayload = {};
    depNames.forEach(dep => { inputPayload[dep] = node.config[dep]; });
    
    // Map resource types to backend actions
    switch (resourceType) {
      case 'spreadsheet':
        actionName = 'listSpreadsheets';
        break;
      case 'sheet':
        actionName = 'listSheets';
        break;
      case 'calendar':
        actionName = 'getCalendars';
        break;
      case 'driveFile':
        actionName = 'getFiles';
        break;
      case 'driveFolder':
        actionName = 'getFolders';
        break;
      case 'form':
        actionName = 'listForms';
        break;
      case 'gbpAccount':
        actionName = 'listAccounts';
        break;
      case 'gbpLocation':
        actionName = 'listLocations';
        break;
      case 'gbpReview':
        actionName = 'listReviews';
        break;
      case 'gbpPost':
        actionName = 'listPosts';
        break;
      case 'document':
        actionName = 'getDocuments';
        break;
      case 'gmailLabel':
        actionName = 'listLabels';
        break;
      case 'gmailMessage':
      case 'gmailThread':
        actionName = 'loadMails';
        break;
      default:
        throw new Error(`Unknown resource type: ${resourceType}`);
    }
    
    const res = await fetch(`${API}/api/${node.module}/${actionName}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ connectionId: node.connectionId, input: inputPayload }),
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to load resources');
    
    let options = [];
    if (data.output) {
      // Handle different response formats
      if (data.output.spreadsheets) {
        options = data.output.spreadsheets.map(s => ({ value: s.id, label: s.name }));
      } else if (data.output.sheets) {
        options = data.output.sheets.map(s => ({ value: s.title, label: s.title }));
      } else if (data.output.options) {
        options = data.output.options;
      } else if (data.output.calendars) {
        options = data.output.calendars.map(c => ({ value: c.id, label: c.name || c.summary }));
      } else if (data.output.files) {
        options = data.output.files.map(f => ({ value: f.id, label: f.name }));
      } else if (data.output.forms) {
        options = data.output.forms.map(f => ({ value: f.id, label: f.name }));
      } else if (data.output.accounts) {
        options = data.output.accounts.map(a => ({ value: a.name, label: a.accountName || a.name }));
      } else if (data.output.locations) {
        options = data.output.locations.map(l => ({ value: l.name, label: l.title || l.name }));
      } else if (data.output.reviews) {
        options = data.output.reviews.map(r => ({
          value: r.reviewId || r.name,
          label: `${r.reviewer?.displayName || 'Anonymous'} - ${r.starRating || ''} ${(r.comment || '').slice(0, 40)}`,
        }));
      } else if (data.output.posts) {
        options = data.output.posts.map(p => ({
          value: (p.name || '').split('/').pop() || p.name,
          label: (p.summary || p.name || '').slice(0, 50),
        }));
      } else if (data.output.documents) {
        options = data.output.documents.map(d => ({ value: d.id, label: d.name }));
      } else if (data.output.labels) {
        options = data.output.labels.map(l => ({ value: l.id, label: l.name }));
      } else if (data.output.messages) {
        // Same loadMails output backs two different dropdowns: "pick a
        // message" (value = message id) and "pick a thread to reply in"
        // (value = threadId) - resourceType tells us which the field wants.
        options = data.output.messages.map(m => ({
          value: resourceType === 'gmailThread' ? m.threadId : m.id,
          label: `${m.from || ''} - ${m.subject || '(no subject)'}`,
        }));
      }
    }
    
    const currentVal = node.config[currentFieldName] || '';
    selectEl.innerHTML = '<option value="">Select...</option>' + 
      options.map(o => `<option value="${o.value}" ${o.value === currentVal ? 'selected' : ''}>${o.label}</option>`).join('');
    
    if (options.length === 0) {
      showToast('No resources found', 'error');
    }
  } catch (err) {
    showToast('Error loading resources: ' + err.message, 'error');
    selectEl.innerHTML = originalText;
  } finally {
    selectEl.disabled = false;
  }
}

// ---------- quick-add node search (Tab) ----------

function buildQuickAddIndex() {
  const items = [];
  MODULE_ORDER.forEach(moduleName => {
    const def = NODE_DEFS[moduleName];
    if (!def) return;
    const isFirst = !canvasNodes.some(n => n.role === 'trigger');
    (isFirst ? def.triggers : def.actions).forEach(op => {
      items.push({ moduleName, role: isFirst ? 'trigger' : 'action', typeId: op.id, label: `${def.label} · ${op.label}`, icon: def.icon });
    });
  });
  return items;
}

function openQuickAdd() {
  const panel = document.getElementById('quickAdd');
  const input = document.getElementById('quickAddInput');
  panel.classList.add('open');
  input.value = '';
  renderQuickAddList('');
  setTimeout(() => input.focus(), 0);
}

function closeQuickAdd() {
  document.getElementById('quickAdd').classList.remove('open');
}

function renderQuickAddList(query) {
  const list = document.getElementById('quickAddList');
  const items = buildQuickAddIndex().filter(it => it.label.toLowerCase().includes(query.toLowerCase()));
  if (!items.length) { list.innerHTML = '<div class="quick-add-empty">No matching triggers/actions.</div>'; return; }
  list.innerHTML = items.map((it, i) => `
    <div class="quick-add-item ${i === 0 ? 'active' : ''}" data-add-module="${it.moduleName}" data-add-type="${it.typeId}">
      <span class="icon">${it.icon}</span>${it.label}
    </div>`).join('');
}

function wireQuickAdd() {
  document.getElementById('quickAddBtn').addEventListener('click', openQuickAdd);
  const input = document.getElementById('quickAddInput');
  input.addEventListener('input', () => renderQuickAddList(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeQuickAdd(); }
    if (e.key === 'Enter') {
      const first = document.querySelector('#quickAddList .quick-add-item');
      if (first) first.click();
    }
  });
  document.getElementById('quickAddList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-module]');
    if (!item) return;
    addNode(item.dataset.addModule);
    // set the specific trigger/action type picked, not just the module default
    const node = canvasNodes[canvasNodes.length - 1];
    if (node) node.typeId = item.dataset.addType;
    closeQuickAdd();
    renderCanvas();
    renderNodeSide();
    renderProps();
  });
  document.getElementById('canvasScroll').addEventListener('mousedown', (e) => {
    if (!e.target.closest('.quick-add')) closeQuickAdd();
  });
}

// ---------- keyboard shortcuts ----------

function isTypingInField() {
  const tag = document.activeElement && document.activeElement.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function wireKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('quickAdd').classList.contains('open')) return; // let its own handler run

    if (e.key === 'Tab' && !isTypingInField()) {
      e.preventDefault();
      openQuickAdd();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isTypingInField() && selectedNodeId) {
      e.preventDefault();
      removeNode(selectedNodeId);
      return;
    }
    if ((e.key === '+' || e.key === '=') && !isTypingInField()) { setZoom(zoom * 1.2); return; }
    if (e.key === '-' && !isTypingInField()) { setZoom(zoom / 1.2); return; }
    if (e.key === '0' && !isTypingInField()) { resetZoom(); return; }
    if (e.key === 'Escape') { closeQuickAdd(); dragEdgeState = null; drawEdges(); }
  });
}

// ---------- save / run ----------

function buildInputMapForNode(node, typeDef) {
  const inputMap = {};
  (typeDef.fields || []).forEach(f => {
    const raw = node.config[f.name];
    if (raw === undefined || raw === '' ) return;
    setPath(inputMap, f.path || f.name, parseFieldValue(f, raw));
  });
  return inputMap;
}

// Walks the connector graph from the trigger node to produce the ordered
// chain the backend's linear flowRunner expects. Returns null (and toasts
// an explanation) if the graph isn't a single connected chain yet.
function computeOrderedChain(opts) {
  const silent = !!(opts && opts.silent);
  const warn = (msg) => { if (!silent) showToast(msg, 'error'); };

  if (canvasNodes.length === 0) return null;
  const trigger = canvasNodes.find(n => n.role === 'trigger');
  if (!trigger) { warn('Add a trigger node first (it must be the first node you add).'); return null; }

  const nextByFrom = new Map(edges.map(e => [e.from, e.to]));
  const chain = [trigger];
  const seen = new Set([trigger.id]);
  let cur = trigger;
  while (nextByFrom.has(cur.id)) {
    const nextId = nextByFrom.get(cur.id);
    if (seen.has(nextId)) { warn('That connector graph loops back on itself - remove the cycle before saving.'); return null; }
    const nextNode = canvasNodes.find(n => n.id === nextId);
    if (!nextNode) break;
    chain.push(nextNode);
    seen.add(nextNode.id);
    cur = nextNode;
  }

  const unconnected = canvasNodes.filter(n => !seen.has(n.id));
  if (unconnected.length) {
    warn(`${unconnected.length} node(s) aren't connected into the trigger's chain yet - drag a connector from the previous node's output socket into each one's input socket.`);
    return null;
  }
  return chain;
}

// Returns the ordered list of *action* steps that come before `node` in the
// connector chain, i.e. the steps whose output `node` is allowed to map a
// field from. Index in the returned array === the step's order_index, which
// is exactly what the backend's flowRunner keys `results` by (see
// src/lib/flowRunner.js), so `{{<that index>.someField}}` in a field always
// lines up with what actually ran before this node once saved.
function getUpstreamStepsFor(node) {
  const chain = computeOrderedChain({ silent: true });
  if (!chain || !node) return [];
  const hasTrigger = chain[0] && chain[0].role === 'trigger';
  const actionChain = hasTrigger ? chain.slice(1) : chain;
  const idx = actionChain.findIndex(n => n.id === node.id);
  if (idx <= 0) return []; // first action step (or node not placed in the chain yet) has nothing upstream
  return actionChain.slice(0, idx).map((n, i) => {
    const def = NODE_DEFS[n.module];
    const typeDef = nodeTypeDef(n);
    return {
      orderIndex: i,
      label: `${def ? def.label : n.module} — ${typeDef ? typeDef.label : (n.typeId || 'untitled')}`,
    };
  });
}

function varPickerHtml(fieldName, upstreamSteps) {
  if (!upstreamSteps.length) return '';
  return `
    <div class="var-picker" data-var-for="${fieldName}">
      <button type="button" class="var-btn" title="Insert a value from an earlier step">🔗</button>
      <div class="var-menu">
        <div class="var-menu-head">Insert from earlier step</div>
        ${upstreamSteps.map(s => `
          <div class="var-menu-item" data-var-token="{{${s.orderIndex}.field}}">
            <span>${s.label}</span><span class="var-menu-sub">step ${s.orderIndex}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

// Inserts `token` at the current caret position of a text/textarea field,
// leaves the literal word "field" inside the freshly-inserted token
// selected so the user can immediately type the real field/path name over
// it (e.g. "id", "messages.0.from"), and fires a normal `input` event so
// the existing props-panel listener persists it onto node.config exactly
// like manual typing would.
function insertVariableToken(el, token) {
  el.focus();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + token + el.value.slice(end);

  const markerOffset = token.indexOf('field');
  if (markerOffset !== -1) {
    el.setSelectionRange(start + markerOffset, start + markerOffset + 'field'.length);
  } else {
    const caret = start + token.length;
    el.setSelectionRange(caret, caret);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function saveFlow() {
  const name = document.getElementById('flowNameInput').value.trim() || 'Untitled flow';
  if (canvasNodes.length === 0) return showToast('Add at least one node first.', 'error');

  const chain = computeOrderedChain();
  if (!chain) return;

  for (const n of chain) {
    if (!n.connectionId) return showToast(`Pick an account for the ${NODE_DEFS[n.module].label} node.`, 'error');
    if (!n.typeId) return showToast(`Pick a trigger/action for the ${NODE_DEFS[n.module].label} node.`, 'error');
  }

  let triggerType = 'manual';
  let triggerConfig = {};
  let actionNodes = chain;

  if (chain[0].role === 'trigger') {
    const triggerNode = chain[0];
    const triggerDef = nodeTypeDef(triggerNode);
    triggerType = triggerDef && triggerDef.kind === 'webhook' ? 'webhook' : 'schedule';
    triggerConfig = {
      module: triggerNode.module,
      trigger: triggerNode.typeId,
      connectionId: triggerNode.connectionId,
      config: buildInputMapForNode(triggerNode, triggerDef),
    };
    actionNodes = chain.slice(1);
  }

  if (actionNodes.length === 0) {
    return showToast('Add at least one action node after the trigger.', 'error');
  }

  const steps = actionNodes.map(n => ({
    module: n.module,
    action: n.typeId,
    connectionId: n.connectionId,
    inputMap: buildInputMapForNode(n, nodeTypeDef(n)),
  }));

  try {
    const res = await fetch(API + '/flows', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ name, triggerType, triggerConfig, steps }),
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.message || data.error || 'Save failed', 'error');
    lastSavedFlowId = data.flow.id;
    document.getElementById('canvasStatus').textContent = `Saved as "${name}"`;
    showToast('Flow saved.', 'ok');
    await loadFlows();
  } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

async function runFlow() {
  const id = lastSavedFlowId || document.getElementById('flowSelect').value;
  if (!id) return showToast('Save the flow first (or pick a saved one from the dropdown).', 'error');
  document.getElementById('canvasStatus').textContent = 'Running…';
  try {
    const res = await fetch(`${API}/flows/${id}/run`, { method: 'POST', headers: headers() });
    const data = await res.json();
    document.getElementById('canvasStatus').textContent = `Run ${data.status}` + (data.error ? ': ' + data.error : '');
    showToast(`Run ${data.status}` + (data.error ? ': ' + data.error : ''), data.status === 'success' ? 'ok' : 'error');
  } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

// ---------- init ----------

function wireStaticButtons() {
  document.getElementById('toggleSideBtn').addEventListener('click', () => {
    document.getElementById('nodeSide').classList.toggle('collapsed');
  });
  document.getElementById('saveFlowBtn').addEventListener('click', saveFlow);
  document.getElementById('runFlowBtn').addEventListener('click', runFlow);
  document.getElementById('flowSelect').addEventListener('change', (e) => {
    if (e.target.value) document.getElementById('canvasStatus').textContent = 'Selected a saved flow to run — click "Run now".';
  });

  wireModuleBarDelegation();
  wireZoomPan();
  wireCanvasDragAndSelect();
  wireNodeSideDelegation();
  wirePropsDelegation();
  wireQuickAdd();
  wireKeyboardShortcuts();

  // OAuth redirect lands back here with ?provider=&email= - refresh connections.
  const params = new URLSearchParams(location.search);
  if (params.get('provider')) {
    showToast(`Connected ${params.get('provider')} account: ${params.get('email') || ''}`, 'ok');
    history.replaceState({}, '', '/flow-builder.html');
    loadConnections().then(renderModuleBar);
  }
}

document.addEventListener('DOMContentLoaded', init);
PLACEHOLDER_MAPPING_EOF
echo "wrote public/js/flow-builder.js"

mkdir -p "$(dirname "public/flow-builder.html")"
cat > public/flow-builder.html << 'PLACEHOLDER_MAPPING_EOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Flow Builder · sm-server</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --navy: #1a2233;
    --navy-2: #232d42;
    --ink: #1f2430;
    --ink-dim: #6b7280;
    --line: #e3e6ec;
    --surface: #ffffff;
    --canvas-bg: #f6f7fb;
    --accent: #3b5bfd;
    --accent-dim: #eef1ff;
    --ok: #16a34a;
    --danger: #dc2626;
    --sans: 'Inter', system-ui, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--sans); color: var(--ink); background: var(--canvas-bg); }
  a { color: inherit; }
  button { font-family: var(--sans); cursor: pointer; }

  /* ---- topbar ---- */
  .topbar {
    height: 56px; background: var(--navy); color: #fff; display: flex; align-items: center;
    padding: 0 20px; gap: 16px; flex-shrink: 0;
  }
  .hamburger { background: none; border: none; color: #fff; font-size: 18px; padding: 6px; border-radius: 6px; }
  .hamburger:hover { background: rgba(255,255,255,0.08); }
  .brand { font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
  .topbar .spacer { flex: 1; }
  .top-link { font-size: 13px; color: #c7cde0; text-decoration: none; padding: 6px 10px; border-radius: 6px; }
  .top-link:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .keypill { font-family: var(--mono); font-size: 11px; color: #c7cde0; background: rgba(255,255,255,0.08); padding: 6px 10px; border-radius: 6px; }

  /* ---- module bar ---- */
  .module-bar { display: flex; gap: 14px; padding: 18px 20px; overflow-x: auto; background: var(--surface); border-bottom: 1px solid var(--line); }
  .module-card {
    flex: 0 0 150px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 12px; text-align: center; transition: box-shadow .15s, border-color .15s; cursor: pointer;
  }
  .module-card:hover { border-color: var(--accent); box-shadow: 0 4px 14px rgba(59,91,253,0.12); }
  .module-card .icon { font-size: 30px; line-height: 1; margin-bottom: 8px; }
  .module-card .name { font-weight: 600; font-size: 14px; margin-bottom: 10px; }
  .module-card .connect-btn {
    background: var(--navy); color: #fff; border: none; border-radius: 999px; padding: 6px 16px;
    font-size: 12px; font-weight: 600;
  }
  .module-card .connect-btn:hover { background: var(--navy-2); }
  .module-card .conn-status { font-size: 11px; color: var(--ink-dim); margin-top: 10px; line-height: 1.4; }
  .module-card .conn-status.on { color: var(--ok); }
  .module-card .add-hint { font-size: 10px; color: var(--accent); margin-top: 6px; opacity: 0; transition: opacity .15s; }
  .module-card:hover .add-hint { opacity: 1; }
  .acc-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--canvas-bg); border: 1px solid var(--line); border-radius: 999px; padding: 1px 3px 1px 8px; margin: 2px 2px 0 0; }
  .acc-chip-x { border: none; background: none; color: var(--danger); font-size: 12px; line-height: 1; cursor: pointer; padding: 2px 5px; border-radius: 50%; }
  .acc-chip-x:hover { background: rgba(220,38,38,0.12); }

  /* ---- builder layout ---- */
  .builder { display: flex; height: calc(100vh - 56px - 106px); }
  .node-side {
    width: 260px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--line);
    overflow-y: auto; transition: margin-left .15s;
  }
  .node-side.collapsed { margin-left: -260px; }
  .node-side-empty { padding: 24px 18px; color: var(--ink-dim); font-size: 13px; }
  .node-side h2 { font-size: 15px; margin: 16px 18px 4px; display: flex; align-items: center; gap: 8px; }
  .node-side .group-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-dim); margin: 16px 18px 6px; }
  .op-item {
    display: flex; align-items: center; gap: 10px; padding: 9px 18px; font-size: 13px; cursor: pointer;
  }
  .op-item:hover { background: var(--canvas-bg); }
  .op-item.selected { background: var(--accent-dim); color: var(--accent); font-weight: 600; }
  .op-marker { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #c6cad3; flex-shrink: 0; }
  .op-item.selected .op-marker { border-color: var(--accent); background: var(--accent); }
  .op-item.trigger .op-marker { border-radius: 4px; }

  /* ---- canvas ---- */
  .canvas-wrap { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .canvas-toolbar {
    display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .canvas-toolbar input[type=text] {
    border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; font-size: 13px; width: 220px;
  }
  .tbtn { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 7px 14px; font-size: 13px; font-weight: 600; }
  .tbtn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .tbtn.primary:hover { background: #2b4ae0; }
  .tbtn:hover { border-color: var(--accent); }
  .canvas-toolbar select { border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; font-size: 13px; }
  .canvas-toolbar .spacer { flex: 1; }
  .canvas-status { font-size: 12px; color: var(--ink-dim); }
  .zoom-group { display: flex; align-items: center; gap: 2px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .zoom-group button { border: none; background: var(--surface); padding: 7px 10px; font-size: 14px; font-weight: 700; border-right: 1px solid var(--line); }
  .zoom-group button:last-child { border-right: none; }
  .zoom-group button:hover { background: var(--canvas-bg); }
  .zoom-pct { font-size: 11px; color: var(--ink-dim); width: 40px; text-align: center; font-family: var(--mono); }

  .canvas-scroll {
    flex: 1; position: relative; overflow: hidden; background-color: var(--canvas-bg);
    background-image: radial-gradient(circle, #dcdfe8 1px, transparent 1px);
    background-size: calc(22px * var(--zoom, 1)) calc(22px * var(--zoom, 1));
    background-position: var(--panx, 0px) var(--pany, 0px);
    cursor: grab;
  }
  .canvas-scroll.panning { cursor: grabbing; }
  .canvas-inner {
    position: absolute; top: 0; left: 0; width: 2400px; height: 1600px;
    transform-origin: 0 0;
    transform: translate(var(--panx, 0px), var(--pany, 0px)) scale(var(--zoom, 1));
  }
  #edgesSvg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  #edgesSvg path.edge-line { fill: none; stroke: #9aa3b8; stroke-width: 2.5; pointer-events: stroke; cursor: pointer; }
  #edgesSvg path.edge-line:hover { stroke: var(--danger); }
  #edgesSvg path.edge-hit { fill: none; stroke: transparent; stroke-width: 16; pointer-events: stroke; cursor: pointer; }
  #edgesSvg path.edge-drawing { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-dasharray: 6 4; pointer-events: none; }
  .edge-del-btn { pointer-events: auto; cursor: pointer; }
  .edge-del-btn circle { fill: #fff; stroke: var(--danger); stroke-width: 1.5; }
  .edge-del-btn text { fill: var(--danger); font-size: 11px; font-family: var(--sans); text-anchor: middle; dominant-baseline: central; font-weight: 700; }
  .edge-del-btn:hover circle { fill: var(--danger); }
  .edge-del-btn:hover text { fill: #fff; }

  .node-box {
    position: absolute; width: 190px; background: var(--surface); border: 2px solid var(--line);
    border-radius: 10px; padding: 10px 12px; cursor: grab; user-select: none; box-shadow: 0 2px 6px rgba(20,25,40,0.06);
  }
  .node-box.selected { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
  .node-box.drag-target { border-color: var(--ok); box-shadow: 0 0 0 3px rgba(22,163,74,0.18); }
  .node-box .nb-head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
  .node-box .nb-icon { font-size: 18px; }
  .node-box .nb-sub { font-size: 11px; color: var(--ink-dim); margin-top: 4px; padding-left: 26px; }
  .node-box .nb-role { position: absolute; top: -9px; left: 10px; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; background: var(--navy); color: #fff; padding: 1px 7px; border-radius: 999px; }
  .node-box .nb-remove { position: absolute; top: -9px; right: -9px; width: 20px; height: 20px; border-radius: 50%; background: #fff; border: 1px solid var(--line); font-size: 12px; line-height: 1; display: flex; align-items: center; justify-content: center; color: var(--danger); z-index: 3; }
  .node-box .nb-socket {
    position: absolute; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; border-radius: 50%;
    background: #fff; border: 2px solid #9aa3b8; z-index: 2; cursor: crosshair;
  }
  .node-box .nb-socket:hover { border-color: var(--accent); background: var(--accent-dim); transform: translateY(-50%) scale(1.2); }
  .node-box .nb-socket.out { right: -7px; }
  .node-box .nb-socket.in { left: -7px; }
  .node-box .nb-socket.filled { background: var(--accent); border-color: var(--accent); }

  .canvas-empty { position: absolute; top: 40%; left: 50%; transform: translate(-50%,-50%); text-align: center; color: var(--ink-dim); font-size: 14px; max-width: 340px; z-index: -1; }
  .canvas-empty b { color: var(--ink); }
  .canvas-hint { position: absolute; bottom: 14px; left: 14px; background: rgba(26,34,51,0.88); color: #fff; font-size: 11px; padding: 8px 12px; border-radius: 8px; line-height: 1.7; font-family: var(--mono); z-index: 5; }
  .canvas-hint b { color: #9db4ff; }

  /* ---- quick add node search (Tab) ---- */
  .quick-add { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); width: 320px; background: var(--surface);
    border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 12px 32px rgba(20,25,40,0.18); z-index: 20; display: none; overflow: hidden; }
  .quick-add.open { display: block; }
  .quick-add input { width: 100%; border: none; border-bottom: 1px solid var(--line); padding: 12px 14px; font-size: 14px; outline: none; box-sizing: border-box; }
  .quick-add-list { max-height: 320px; overflow-y: auto; }
  .quick-add-item { display: flex; align-items: center; gap: 10px; padding: 9px 14px; font-size: 13px; cursor: pointer; }
  .quick-add-item:hover, .quick-add-item.active { background: var(--accent-dim); }
  .quick-add-item .icon { font-size: 16px; }
  .quick-add-empty { padding: 14px; font-size: 12px; color: var(--ink-dim); }

  /* ---- properties panel ---- */
  .props-panel { width: 300px; flex-shrink: 0; background: var(--surface); border-left: 1px solid var(--line); overflow-y: auto; padding: 18px; }
  .props-panel h2 { font-size: 15px; margin: 0 0 14px; }
  .props-empty { color: var(--ink-dim); font-size: 13px; }
  .pfield { margin-bottom: 14px; }
  .pfield label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
  .pfield input[type=text], .pfield input[type=number], .pfield select, .pfield textarea {
    width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: var(--sans);
  }
  .pfield textarea { resize: vertical; min-height: 60px; }
  .pfield .hint { font-size: 11px; color: var(--ink-dim); margin-top: 4px; }
  .conn-select-row { margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }

  /* ---- insert-variable ("placeholder mapping") picker ---- */
  .pfield-input-row { display: flex; align-items: flex-start; gap: 6px; }
  .pfield-input-row input, .pfield-input-row textarea { flex: 1 1 auto; min-width: 0; }
  .var-picker { position: relative; flex: 0 0 auto; }
  .var-btn {
    width: 32px; height: 32px; border: 1px solid var(--line); background: var(--surface);
    border-radius: 6px; font-size: 14px; cursor: pointer; line-height: 1;
  }
  .var-btn:hover { border-color: var(--accent); }
  .var-menu {
    display: none; position: absolute; right: 0; top: 36px; z-index: 20;
    width: 240px; max-height: 220px; overflow-y: auto; background: var(--surface);
    border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  }
  .var-picker.open .var-menu { display: block; }
  .var-menu-head { font-size: 11px; font-weight: 700; color: var(--ink-dim); padding: 8px 10px 4px; text-transform: uppercase; letter-spacing: .03em; }
  .var-menu-item {
    display: flex; justify-content: space-between; gap: 8px; align-items: center;
    padding: 8px 10px; font-size: 12px; cursor: pointer;
  }
  .var-menu-item:hover { background: var(--accent-dim); }
  .var-menu-sub { font-size: 10px; color: var(--ink-dim); font-family: var(--mono); flex-shrink: 0; }
  .pfield .hint code { background: var(--accent-dim); padding: 1px 4px; border-radius: 4px; font-family: var(--mono); }

  .toast { position: fixed; bottom: 20px; right: 20px; background: var(--ink); color: #fff; padding: 12px 16px; border-radius: 8px; font-size: 13px; max-width: 340px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); z-index: 50; }
  .toast.error { background: var(--danger); }
  .toast.ok { background: var(--ok); }
</style>
</head>
<body>

<div class="topbar">
  <button class="hamburger" id="toggleSideBtn">☰</button>
  <div class="brand">Google APIs</div>
  <div class="spacer"></div>
  <a class="top-link" href="/">Classic dashboard</a>
  <div class="keypill" id="keyPill">no API key</div>
</div>

<div class="module-bar" id="moduleBar"></div>

<div class="builder">
  <aside class="node-side" id="nodeSide">
    <div class="node-side-empty" id="nodeSideEmpty">Select a node on the canvas to see its triggers and actions here.</div>
  </aside>

  <div class="canvas-wrap">
    <div class="canvas-toolbar">
      <input type="text" id="flowNameInput" placeholder="Untitled flow" />
      <button class="tbtn primary" id="saveFlowBtn">Save flow</button>
      <button class="tbtn" id="runFlowBtn">Run now</button>
      <div class="zoom-group">
        <button type="button" id="zoomOutBtn" title="Zoom out (-)">−</button>
        <span class="zoom-pct" id="zoomPct">100%</span>
        <button type="button" id="zoomInBtn" title="Zoom in (+)">+</button>
        <button type="button" id="zoomResetBtn" title="Reset zoom (0)">⤢</button>
      </div>
      <button class="tbtn" id="quickAddBtn" title="Add node (Tab)">+ Add node</button>
      <div class="spacer"></div>
      <span class="canvas-status" id="canvasStatus"></span>
      <select id="flowSelect"><option value="">My saved flows…</option></select>
    </div>
    <div class="canvas-scroll" id="canvasScroll">
      <div class="canvas-inner" id="canvasInner">
        <svg id="edgesSvg"></svg>
        <div id="canvas"></div>
      </div>
      <div class="canvas-empty" id="canvasEmpty">
        Click a module above, or press <b>Tab</b>, to drop its first node here — <b>the first node you add is the trigger</b>,
        then connect each next node's input socket to the previous node's output socket to build the run order.
      </div>
      <div class="canvas-hint">
        <b>Scroll</b> zoom · <b>drag canvas</b> pan · <b>drag node</b> move · <b>drag socket→socket</b> connect ·
        <b>click edge</b> disconnect · <b>Del</b> remove node · <b>Tab</b> add node · <b>0</b> reset zoom
      </div>
      <div class="quick-add" id="quickAdd">
        <input type="text" id="quickAddInput" placeholder="Search modules, triggers, actions…" />
        <div class="quick-add-list" id="quickAddList"></div>
      </div>
    </div>
  </div>

  <aside class="props-panel" id="propsPanel">
    <h2>Node Properties</h2>
    <div class="props-empty" id="propsEmpty">Nothing selected.</div>
  </aside>
</div>

<script src="js/nodeDefs.js"></script>
<script src="js/flow-builder.js"></script>
</body>
</html>
PLACEHOLDER_MAPPING_EOF
echo "wrote public/flow-builder.html"

echo "Done. All 3 files written."