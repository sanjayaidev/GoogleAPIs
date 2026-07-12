// Node-canvas flow builder. Talks to the exact same backend as the classic
// dashboard (public/js/app.js) - /connections, /oauth/google/start,
// /flows - so anything built here is a real, runnable flow, not a mockup.
//
// Simplification (matches the linear flowRunner - see src/lib/flowRunner.js):
// node order = execution order. Dragging repositions a node visually but does
// not reorder the chain; the first node you add is treated as the trigger,
// everything after is an ordered action step. Real branching isn't
// implemented server-side yet, so this canvas doesn't offer it either.

const API = '';
let apiKey = localStorage.getItem('sm_api_key') || null;
let modulesCache = [];       // [{name, provider, actions, triggers}]
let connectionsCache = [];   // [{id, provider, account_label, status}]
let flowsCache = [];
let canvasNodes = [];        // [{id, module, role, typeId, connectionId, config, x, y}]
let selectedNodeId = null;
let lastSavedFlowId = null;
let nodeSeq = 1;

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

function connectionsForModule(moduleName) {
  const provider = providerFor(moduleName);
  return connectionsCache.filter(c => c.provider === provider && c.status === 'active');
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
          ${connected ? conns.map(c => 'Account Connected: ' + c.account_label).join('<br>') : 'Not connected'}
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

// ---------- canvas: nodes + edges ----------

function addNode(moduleName) {
  const def = NODE_DEFS[moduleName];
  if (!def) return;
  const isFirst = canvasNodes.length === 0;
  const firstTrigger = def.triggers[0];
  const firstAction = def.actions[0];
  if (isFirst && !firstTrigger) {
    showToast(`${def.label} has no trigger defined yet, so it can't be the first node.`, 'error');
    return;
  }
  const conns = connectionsForModule(moduleName);
  const node = {
    id: 'n' + (nodeSeq++),
    module: moduleName,
    role: isFirst ? 'trigger' : 'action',
    typeId: isFirst ? firstTrigger.id : (firstAction ? firstAction.id : ''),
    connectionId: conns[0] ? conns[0].id : '',
    config: {},
    x: 40 + (canvasNodes.length % 4) * 230,
    y: 40 + Math.floor(canvasNodes.length / 4) * 130,
  };
  canvasNodes.push(node);
  selectedNodeId = node.id;
  renderCanvas();
  renderNodeSide();
  renderProps();
}

function removeNode(id) {
  canvasNodes = canvasNodes.filter(n => n.id !== id);
  if (selectedNodeId === id) selectedNodeId = null;
  renderCanvas();
  renderNodeSide();
  renderProps();
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

  canvas.innerHTML = canvasNodes.map((n, i) => {
    const def = NODE_DEFS[n.module];
    const typeDef = nodeTypeDef(n);
    const conns = connectionsForModule(n.module);
    const conn = conns.find(c => c.id === n.connectionId);
    return `
      <div class="node-box ${n.id === selectedNodeId ? 'selected' : ''}" data-node-id="${n.id}" style="left:${n.x}px; top:${n.y}px;">
        <div class="nb-role">${n.role}</div>
        <button class="nb-remove" type="button" data-remove-node="${n.id}" title="Remove node">✕</button>
        <div class="nb-head"><span class="nb-icon">${def.icon}</span>${def.label}</div>
        <div class="nb-sub">${typeDef ? typeDef.label : 'choose an operation'}${conn ? ' · ' + conn.account_label : ''}</div>
        ${i < canvasNodes.length - 1 ? '<div class="nb-socket"></div>' : ''}
      </div>`;
  }).join('');

  drawEdges();
}

function drawEdges() {
  const svg = document.getElementById('edgesSvg');
  const nodeW = 190, nodeH = 56;
  let paths = '';
  for (let i = 1; i < canvasNodes.length; i++) {
    const a = canvasNodes[i - 1], b = canvasNodes[i];
    const x1 = a.x + nodeW, y1 = a.y + nodeH / 2;
    const x2 = b.x, y2 = b.y + nodeH / 2;
    const mx = (x1 + x2) / 2;
    paths += `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" />`;
  }
  svg.innerHTML = paths;
}

function wireCanvasDragAndSelect() {
  const canvas = document.getElementById('canvas');
  let dragging = null; // { id, offsetX, offsetY }

  canvas.addEventListener('mousedown', (e) => {
    const removeBtn = e.target.closest('[data-remove-node]');
    if (removeBtn) { removeNode(removeBtn.dataset.removeNode); return; }

    const box = e.target.closest('.node-box');
    if (!box) return;
    const id = box.dataset.nodeId;
    selectedNodeId = id;
    renderCanvas();
    renderNodeSide();
    renderProps();

    const node = canvasNodes.find(n => n.id === id);
    const rect = box.getBoundingClientRect();
    dragging = { id, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    box.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const scrollEl = document.getElementById('canvasScroll');
    const scrollRect = scrollEl.getBoundingClientRect();
    const node = canvasNodes.find(n => n.id === dragging.id);
    if (!node) return;
    node.x = Math.max(0, e.clientX - scrollRect.left + scrollEl.scrollLeft - dragging.offsetX);
    node.y = Math.max(0, e.clientY - scrollRect.top + scrollEl.scrollTop - dragging.offsetY);
    const box = canvas.querySelector(`[data-node-id="${node.id}"]`);
    if (box) { box.style.left = node.x + 'px'; box.style.top = node.y + 'px'; }
    drawEdges();
  });

  document.addEventListener('mouseup', () => { dragging = null; });
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
  const isFirstNode = canvasNodes[0] && canvasNodes[0].id === node.id;

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
      ${conns.length === 0 ? `<div class="hint">No account connected for ${NODE_DEFS[node.module].label} yet — connect one from the module bar above.</div>` : ''}
    </div>`;

  const fields = typeDef ? typeDef.fields : [];
  const fieldsHtml = fields.map(f => {
    const val = node.config[f.name] ?? '';
    if (f.type === 'select') {
      return `<div class="pfield"><label>${f.label}</label><select data-prop-field="${f.name}">
        <option value="">Select Spreadsheet</option>
        ${(f.options || []).map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('')}
      </select></div>`;
    }
    if (f.type === 'textarea') {
      return `<div class="pfield"><label>${f.label}</label><textarea data-prop-field="${f.name}" placeholder="${f.placeholder || ''}">${val}</textarea></div>`;
    }
    if (f.type === 'checkbox') {
      return `<div class="pfield"><label><input type="checkbox" data-prop-field="${f.name}" ${val ? 'checked' : ''} /> ${f.label}</label></div>`;
    }
    return `<div class="pfield"><label>${f.label}</label><input type="${f.type === 'number' ? 'number' : 'text'}" data-prop-field="${f.name}" placeholder="${f.placeholder || ''}" value="${val}" /></div>`;
  }).join('') || '<div class="props-empty">No inputs needed for this operation.</div>';

  panel.innerHTML = `
    <h2>Node Properties</h2>
    ${connRow}
    <div class="group-label" style="margin:0 0 10px; padding:0;">${typeDef ? typeDef.label : 'Choose an operation'}</div>
    ${fieldsHtml}
  `;
}

function wirePropsDelegation() {
  const panel = document.getElementById('propsPanel');
  panel.addEventListener('change', (e) => {
    const node = canvasNodes.find(n => n.id === selectedNodeId);
    if (!node) return;

    if (e.target.id === 'propConnSelect') {
      node.connectionId = e.target.value;
      renderCanvas();
      return;
    }
    const fieldEl = e.target.closest('[data-prop-field]');
    if (!fieldEl) return;
    const typeDef = nodeTypeDef(node);
    const f = (typeDef ? typeDef.fields : []).find(x => x.name === fieldEl.dataset.propField);
    if (!f) return;
    const raw = f.type === 'checkbox' ? fieldEl.checked : fieldEl.value;
    node.config[f.name] = f.type === 'checkbox' ? raw : raw;
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

async function saveFlow() {
  const name = document.getElementById('flowNameInput').value.trim() || 'Untitled flow';
  if (canvasNodes.length === 0) return showToast('Add at least one node first.', 'error');

  for (const n of canvasNodes) {
    if (!n.connectionId) return showToast(`Pick an account for the ${NODE_DEFS[n.module].label} node.`, 'error');
    if (!n.typeId) return showToast(`Pick a trigger/action for the ${NODE_DEFS[n.module].label} node.`, 'error');
  }

  let triggerType = 'manual';
  let triggerConfig = {};
  let actionNodes = canvasNodes;

  if (canvasNodes[0].role === 'trigger') {
    const triggerNode = canvasNodes[0];
    const triggerDef = nodeTypeDef(triggerNode);
    triggerType = triggerDef && triggerDef.kind === 'webhook' ? 'webhook' : 'schedule';
    triggerConfig = {
      module: triggerNode.module,
      trigger: triggerNode.typeId,
      connectionId: triggerNode.connectionId,
      config: buildInputMapForNode(triggerNode, triggerDef),
    };
    actionNodes = canvasNodes.slice(1);
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
  wireCanvasDragAndSelect();
  wireNodeSideDelegation();
  wirePropsDelegation();

  // OAuth redirect lands back here with ?provider=&email= - refresh connections.
  const params = new URLSearchParams(location.search);
  if (params.get('provider')) {
    showToast(`Connected ${params.get('provider')} account: ${params.get('email') || ''}`, 'ok');
    history.replaceState({}, '', '/flow-builder.html');
    loadConnections().then(renderModuleBar);
  }
}

document.addEventListener('DOMContentLoaded', init);
