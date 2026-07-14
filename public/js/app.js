const API = ''; // same origin
let apiKey = localStorage.getItem('sm_api_key') || null;
let modulesCache = [];
let connectionsCache = [];
let stepDrafts = [];

function headers() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
}

function showMsg(el, text, type) {
  el.innerHTML = `<div class="msg ${type}">${text}</div>`;
}

function showPanel(name) {
  const panels = { register: 'registerForm', login: 'loginForm', paste: 'pasteForm' };
  Object.entries(panels).forEach(([key, id]) => {
    document.getElementById(id).style.display = key === name ? 'block' : 'none';
  });
}

function copyKey(key, btn) {
  navigator.clipboard.writeText(key).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => {
    alert('Could not copy automatically - please select and copy the key manually.');
  });
}

function showIssuedKey(msgEl, apiKeyValue, introText) {
  msgEl.innerHTML = `
    <div class="msg success">${introText}</div>
    <div class="keybox" id="issuedKeyBox">${apiKeyValue}</div>
    <div class="msg error">Save this key now — it will not be shown again.</div>
    <button class="btn ghost small" id="copyKeyBtn" type="button">Copy key</button>
    <button class="btn small" id="continueBtn" type="button" style="margin-left:8px;">Continue to dashboard</button>
  `;
  document.getElementById('copyKeyBtn').addEventListener('click', (e) => copyKey(apiKeyValue, e.target));
  document.getElementById('continueBtn').addEventListener('click', enterDashboard);
}

async function register() {
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const msgEl = document.getElementById('gateMsg');
  try {
    const res = await fetch(API + '/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email, password}) });
    const data = await res.json();
    if (!res.ok) return showMsg(msgEl, data.message || data.error, 'error');
    apiKey = data.apiKey;
    localStorage.setItem('sm_api_key', apiKey);
    showIssuedKey(msgEl, apiKey, 'Account created.');
  } catch (e) { showMsg(msgEl, 'Network error: ' + e.message, 'error'); }
}

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const msgEl = document.getElementById('gateMsg');
  try {
    const res = await fetch(API + '/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email, password}) });
    const data = await res.json();
    if (!res.ok) return showMsg(msgEl, data.message || data.error, 'error');
    apiKey = data.apiKey;
    localStorage.setItem('sm_api_key', apiKey);
    showIssuedKey(msgEl, apiKey, 'Logged in.');
  } catch (e) { showMsg(msgEl, 'Network error: ' + e.message, 'error'); }
}

function usePastedKey() {
  const key = document.getElementById('pasteKey').value.trim();
  if (!key) return;
  apiKey = key;
  localStorage.setItem('sm_api_key', apiKey);
  enterDashboard();
}

function logout() {
  localStorage.removeItem('sm_api_key');
  apiKey = null;
  location.href = '/';
}

async function enterDashboard() {
  document.getElementById('gate').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('keyPill').style.display = 'flex';
  document.getElementById('keyPreview').textContent = apiKey.slice(0, 14) + '...';

  await loadModules();
  await loadConnections();
  renderModuleList();
  renderActionSelectors();
  await loadFlows();
  if (stepDrafts.length === 0) addStep();

  const params = new URLSearchParams(location.search);
  if (params.get('provider')) {
    document.getElementById('banner').innerHTML =
      `<div class="msg success">Connected ${params.get('provider')} account: ${params.get('email') || ''}</div>`;
    history.replaceState({}, '', '/');
    await loadConnections();
    renderModuleList();
    renderActionSelectors();
  }
}

async function loadModules() {
  try {
    const res = await fetch(API + '/api', { headers: headers() });
    const data = await res.json();
    if (!res.ok) {
      console.error('[loadModules] request failed', res.status, data);
      showMsg(document.getElementById('banner'), `Could not load modules (${data.error || res.status}). Try logging in again.`, 'error');
      modulesCache = [];
      return;
    }
    modulesCache = data.modules || [];
  } catch (e) {
    console.error('[loadModules] network error', e);
    showMsg(document.getElementById('banner'), 'Network error loading modules: ' + e.message, 'error');
    modulesCache = [];
  }
}

async function loadConnections() {
  try {
    const res = await fetch(API + '/connections', { headers: headers() });
    const data = await res.json();
    if (!res.ok) {
      console.error('[loadConnections] request failed', res.status, data);
      showMsg(document.getElementById('banner'), `Could not load connections (${data.error || res.status}). Try logging in again.`, 'error');
      connectionsCache = [];
      return;
    }
    connectionsCache = data.connections || [];
  } catch (e) {
    console.error('[loadConnections] network error', e);
    showMsg(document.getElementById('banner'), 'Network error loading connections: ' + e.message, 'error');
    connectionsCache = [];
  }
}

// A connection belongs to a module if it was explicitly connected for that
// module. Legacy rows saved before per-module scoping existed have no
// `module` value - fall back to matching on provider alone for those so old
// data doesn't just disappear, but never let a module-scoped connection leak
// into a different module's list.
function connectionsForModule(m) {
  return connectionsCache.filter(c =>
    c.status === 'active' &&
    c.provider === m.provider &&
    (c.module ? c.module === m.name : true)
  );
}

function renderModuleList() {
  const el = document.getElementById('moduleList');
  el.innerHTML = modulesCache.map(m => {
    const conns = connectionsForModule(m);
    const connected = conns.length > 0;
    return `
      <div class="module-row">
        <div class="module-name">
          <span class="socket ${connected ? 'on' : ''}"></span>
          <div>
            <div>${m.name}</div>
            <div class="conn-label">
              ${connected ? conns.map(c => `
                <span class="conn-chip">${c.account_label}
                  <button type="button" class="conn-chip-x" data-disconnect="${c.id}" title="Disconnect this account">×</button>
                </span>`).join(' ') : 'not connected'}
            </div>
          </div>
        </div>
        <button class="btn small ${connected ? 'ghost' : ''}" data-connect-module="${m.name}">${connected ? '+ add another' : 'connect'}</button>
      </div>`;
  }).join('') || '<div class="empty">No modules registered on the server.</div>';
}

async function disconnectConnection(id) {
  if (!confirm('Disconnect this account? Any flow steps using it will stop working until you pick another account.')) return;
  try {
    const res = await fetch(`${API}/connections/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) { const data = await res.json().catch(() => ({})); return showMsg(document.getElementById('banner'), data.message || 'Could not disconnect', 'error'); }
    await loadConnections();
    renderModuleList();
    renderActionSelectors();
  } catch (e) { showMsg(document.getElementById('banner'), 'Network error: ' + e.message, 'error'); }
}

async function connectModule(moduleName) {
  const res = await fetch(`${API}/oauth/google/start?module=${moduleName}`, { headers: headers() });
  const data = await res.json();
  if (data.authUrl) location.href = data.authUrl;
  else alert(data.message || 'Could not start connection');
}

function renderActionSelectors() {
  const modSel = document.getElementById('actionModule');
  modSel.innerHTML = modulesCache.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  updateActionNameOptions();
  updateConnectionOptions();
  renderActionFields();
}

function updateActionNameOptions() {
  const modName = document.getElementById('actionModule').value;
  const mod = modulesCache.find(m => m.name === modName);
  const actSel = document.getElementById('actionName');
  actSel.innerHTML = (mod ? mod.actions : []).map(a => `<option value="${a}">${a}</option>`).join('');
}

function updateConnectionOptions() {
  const modName = document.getElementById('actionModule').value;
  const mod = modulesCache.find(m => m.name === modName);
  const connSel = document.getElementById('actionConnection');
  const relevant = mod ? connectionsForModule(mod) : [];
  connSel.innerHTML = relevant.length
    ? relevant.map(c => `<option value="${c.id}">${c.account_label}</option>`).join('')
    : '<option value="">no connection - connect above first</option>';
}

// Known input fields per action (mirrors each module's inputSchema).
// Hardcoded here for the UI since schemas live server-side as zod objects.
const ACTION_FIELDS = {
  // --- gmail ---
  loadMails: [{name:'query', label:'Search query', placeholder:'is:unread'}, {name:'maxResults', label:'Max results', placeholder:'10', type:'number'}],
  sendMail: [{name:'to', label:'To'}, {name:'subject', label:'Subject'}, {name:'body', label:'Body', textarea:true}],
  createDraft: [{name:'to', label:'To'}, {name:'subject', label:'Subject'}, {name:'body', label:'Body', textarea:true}],
  reply: [
    {name:'threadId', label:'Select Email (thread)', type:'resource', resourceType:'gmailThread'},
    {name:'to', label:'To'}, {name:'subject', label:'Subject'}, {name:'body', label:'Body', textarea:true},
  ],
  markAsRead: [{name:'messageId', label:'Select Email', type:'resource', resourceType:'gmailMessage'}],
  addLabel: [
    {name:'messageId', label:'Select Email', type:'resource', resourceType:'gmailMessage'},
    {name:'labelId', label:'Select Label', type:'resource', resourceType:'gmailLabel'},
  ],

  // --- calendar ---
  listCalendars: [],
  listEvents: [
    {name:'calendarId', label:'Select Calendar', type:'resource', resourceType:'calendar'},
    {name:'timeMin', label:'Time min (RFC3339)', placeholder:'2026-07-12T00:00:00Z'},
    {name:'timeMax', label:'Time max (RFC3339)', placeholder:'2026-07-19T00:00:00Z'},
    {name:'maxResults', label:'Max results', placeholder:'10', type:'number'},
    {name:'query', label:'Search query'},
  ],
  createEvent: [
    {name:'calendarId', label:'Select Calendar', type:'resource', resourceType:'calendar', placeholder:'primary'},
    {name:'summary', label:'Summary'},
    {name:'description', label:'Description', textarea:true},
    {name:'location', label:'Location'},
    {name:'startDateTime', label:'Start date/time (RFC3339)', path:'start.dateTime', placeholder:'2026-07-15T09:00:00-07:00'},
    {name:'startDate', label:'...or start date (all-day)', path:'start.date', placeholder:'2026-07-15'},
    {name:'startTimeZone', label:'Start time zone', path:'start.timeZone', placeholder:'America/Los_Angeles'},
    {name:'endDateTime', label:'End date/time (RFC3339)', path:'end.dateTime', placeholder:'2026-07-15T10:00:00-07:00'},
    {name:'endDate', label:'...or end date (all-day)', path:'end.date', placeholder:'2026-07-15'},
    {name:'endTimeZone', label:'End time zone', path:'end.timeZone', placeholder:'America/Los_Angeles'},
    {name:'attendees', label:'Attendee emails (comma separated)', parse:'csv'},
  ],
  updateEvent: [
    {name:'calendarId', label:'Select Calendar', type:'resource', resourceType:'calendar', placeholder:'primary'},
    {name:'eventId', label:'Event ID'},
    {name:'summary', label:'Summary'},
    {name:'description', label:'Description', textarea:true},
    {name:'location', label:'Location'},
    {name:'startDateTime', label:'Start date/time (RFC3339)', path:'start.dateTime'},
    {name:'startDate', label:'...or start date (all-day)', path:'start.date'},
    {name:'startTimeZone', label:'Start time zone', path:'start.timeZone'},
    {name:'endDateTime', label:'End date/time (RFC3339)', path:'end.dateTime'},
    {name:'endDate', label:'...or end date (all-day)', path:'end.date'},
    {name:'endTimeZone', label:'End time zone', path:'end.timeZone'},
  ],
  deleteEvent: [
    {name:'calendarId', label:'Select Calendar', type:'resource', resourceType:'calendar', placeholder:'primary'},
    {name:'eventId', label:'Event ID'},
  ],

  // --- sheets ---
  listSpreadsheets: [
    {name:'query', label:'Search query (optional)', placeholder:'budget'},
    {name:'maxResults', label:'Max results', placeholder:'50', type:'number'},
  ],
  listSheets: [
    {name:'spreadsheetId', label:'Spreadsheet ID'},
  ],
  createSpreadsheet: [
    {name:'title', label:'Title'},
    {name:'sheetTitle', label:'First sheet title', placeholder:'Sheet1'},
  ],
  readRange: [
    {name:'spreadsheetId', label:'Select Spreadsheet', type:'resource', resourceType:'spreadsheet'},
    {name:'sheetName', label:'Select Sheet/Page', type:'resource', resourceType:'sheet', dependsOn:'spreadsheetId'},
    {name:'range', label:'Range', placeholder:'A1:D20'},
  ],
  appendRow: [
    {name:'spreadsheetId', label:'Select Spreadsheet', type:'resource', resourceType:'spreadsheet'},
    {name:'sheetName', label:'Select Sheet/Page', type:'resource', resourceType:'sheet', dependsOn:'spreadsheetId'},
    {name:'range', label:'Range', placeholder:'A1'},
    {name:'values', label:'Row values (comma separated)', placeholder:'a, b, c', parse:'csv'},
  ],
  updateRange: [
    {name:'spreadsheetId', label:'Select Spreadsheet', type:'resource', resourceType:'spreadsheet'},
    {name:'sheetName', label:'Select Sheet/Page', type:'resource', resourceType:'sheet', dependsOn:'spreadsheetId'},
    {name:'range', label:'Range', placeholder:'A1:B2'},
    {name:'values', label:'Values (JSON array of rows)', textarea:true, placeholder:'[["a","b"],["c","d"]]', parse:'json'},
  ],
  clearRange: [
    {name:'spreadsheetId', label:'Select Spreadsheet', type:'resource', resourceType:'spreadsheet'},
    {name:'sheetName', label:'Select Sheet/Page', type:'resource', resourceType:'sheet', dependsOn:'spreadsheetId'},
    {name:'range', label:'Range'},
  ],
  getRow: [
    {name:'spreadsheetId', label:'Select Spreadsheet', type:'resource', resourceType:'spreadsheet'},
    {name:'sheetName', label:'Select Sheet/Page', type:'resource', resourceType:'sheet', dependsOn:'spreadsheetId'},
    {name:'rowNumber', label:'Row number', type:'number'},
  ],
  deleteRow: [
    {name:'spreadsheetId', label:'Select Spreadsheet', type:'resource', resourceType:'spreadsheet'},
    {name:'sheetName', label:'Select Sheet/Page', type:'resource', resourceType:'sheet', dependsOn:'spreadsheetId'},
    {name:'rowNumber', label:'Row number', type:'number'},
  ],

  // --- docs ---
  listDocuments: [
    {name:'query', label:'Extra Drive query (optional)', placeholder:"name contains 'report'"},
    {name:'maxResults', label:'Max results', placeholder:'20', type:'number'},
  ],
  createDocument: [
    {name:'title', label:'Title'},
    {name:'body', label:'Body text', textarea:true},
  ],
  getDocument: [{name:'documentId', label:'Select Document', type:'resource', resourceType:'document'}],
  appendText: [
    {name:'documentId', label:'Select Document', type:'resource', resourceType:'document'},
    {name:'text', label:'Text', textarea:true},
  ],
  replaceAllText: [
    {name:'documentId', label:'Select Document', type:'resource', resourceType:'document'},
    {name:'findText', label:'Find text'},
    {name:'replaceText', label:'Replace text'},
    {name:'matchCase', label:'Match case', type:'checkbox'},
  ],

  // --- drive ---
  listFiles: [
    {name:'query', label:'Query', placeholder:"name contains 'report'"},
    {name:'maxResults', label:'Max results', placeholder:'20', type:'number'},
  ],
  getFile: [{name:'fileId', label:'Select File', type:'resource', resourceType:'driveFile'}],
  uploadFile: [
    {name:'name', label:'File name'},
    {name:'mimeType', label:'MIME type', placeholder:'text/plain'},
    {name:'content', label:'Content', textarea:true},
    {name:'parentFolderId', label:'Parent folder ID', type:'resource', resourceType:'driveFolder'},
  ],
  createFolder: [
    {name:'name', label:'Folder name'},
    {name:'parentFolderId', label:'Parent folder ID', type:'resource', resourceType:'driveFolder'},
  ],
  deleteFile: [{name:'fileId', label:'Select File', type:'resource', resourceType:'driveFile'}],
  shareFile: [
    {name:'fileId', label:'Select File', type:'resource', resourceType:'driveFile'},
    {name:'email', label:'Share with (email)'},
    {name:'role', label:'Role', type:'select', options:['reader','commenter','writer']},
  ],

  // --- forms ---
  listForms: [
    {name:'query', label:'Search query (optional)', placeholder:'survey'},
    {name:'maxResults', label:'Max results', placeholder:'20', type:'number'},
  ],
  createForm: [
    {name:'title', label:'Title'},
    {name:'description', label:'Description', textarea:true},
  ],
  getForm: [{name:'formId', label:'Select Form', type:'resource', resourceType:'form'}],
  addQuestion: [
    {name:'formId', label:'Select Form', type:'resource', resourceType:'form'},
    {name:'title', label:'Question title'},
    {name:'type', label:'Question type', type:'select', options:['TEXT','PARAGRAPH_TEXT','MULTIPLE_CHOICE','CHECKBOX','DROPDOWN']},
    {name:'options', label:'Choices (comma separated, for choice types)', parse:'csv'},
    {name:'required', label:'Required', type:'checkbox'},
    {name:'index', label:'Insert position (index)', placeholder:'0', type:'number'},
  ],
  listResponses: [{name:'formId', label:'Select Form', type:'resource', resourceType:'form'}],

  // --- googleBusinessProfile ---
  listAccounts: [],
  listLocations: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'maxResults', label:'Max results', placeholder:'20', type:'number'},
  ],
  getLocation: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'locationId', label:'Select Location', type:'resource', resourceType:'gbpLocation', dependsOn:'accountId'},
  ],
  getDailyMetrics: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'locationId', label:'Select Location', type:'resource', resourceType:'gbpLocation', dependsOn:'accountId'},
    {name:'metric', label:'Metric', type:'select', options:[
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'CALL_CLICKS','WEBSITE_CLICKS','BUSINESS_DIRECTION_REQUESTS',
    ]},
    {name:'startDate', label:'Start date', placeholder:'2026-07-01'},
    {name:'endDate', label:'End date', placeholder:'2026-07-12'},
  ],
  listReviews: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'locationId', label:'Select Location', type:'resource', resourceType:'gbpLocation', dependsOn:'accountId'},
  ],
  replyToReview: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'locationId', label:'Select Location', type:'resource', resourceType:'gbpLocation', dependsOn:'accountId'},
    {name:'reviewId', label:'Select Review', type:'resource', resourceType:'gbpReview', dependsOn:'accountId,locationId'},
    {name:'comment', label:'Reply comment', textarea:true},
  ],
  deleteReviewReply: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'locationId', label:'Select Location', type:'resource', resourceType:'gbpLocation', dependsOn:'accountId'},
    {name:'reviewId', label:'Select Review', type:'resource', resourceType:'gbpReview', dependsOn:'accountId,locationId'},
  ],
  listPosts: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'locationId', label:'Select Location', type:'resource', resourceType:'gbpLocation', dependsOn:'accountId'},
  ],
  createPost: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'locationId', label:'Select Location', type:'resource', resourceType:'gbpLocation', dependsOn:'accountId'},
    {name:'summary', label:'Post text', textarea:true},
    {name:'topicType', label:'Post type', type:'select', options:['STANDARD','EVENT','OFFER','ALERT']},
    {name:'actionUrl', label:'Learn more URL (optional)'},
  ],
  deletePost: [
    {name:'accountId', label:'Select Account', type:'resource', resourceType:'gbpAccount'},
    {name:'locationId', label:'Select Location', type:'resource', resourceType:'gbpLocation', dependsOn:'accountId'},
    {name:'postId', label:'Select Post', type:'resource', resourceType:'gbpPost', dependsOn:'accountId,locationId'},
  ],
};

// Reads a dotted path off nested fields (e.g. 'start.dateTime') and writes
// it into the right nested shape for the server's zod schemas (e.g.
// { start: { dateTime: value } }) - most fields are flat and path === name.
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

function parseFieldValue(f, rawValue) {
  if (f.type === 'number') return rawValue === '' ? undefined : Number(rawValue);
  if (f.parse === 'csv') return rawValue.split(',').map(s => s.trim()).filter(Boolean);
  if (f.parse === 'json') {
    try { return JSON.parse(rawValue); } catch (e) { return rawValue; }
  }
  return rawValue;
}

// Reads form-field elements (by DOM id `${idPrefix}_${f.name}`) into a
// properly-shaped input object, honoring each field's `path`/`parse`/`type`.
function buildInputFromFields(fields, idPrefix) {
  const input = {};
  fields.forEach(f => {
    const el = document.getElementById(idPrefix + '_' + f.name);
    if (!el) return;
    if (f.type === 'checkbox') {
      if (el.checked) setPath(input, f.path || f.name, true);
      return;
    }
    if (el.value === '') return;
    setPath(input, f.path || f.name, parseFieldValue(f, el.value));
  });
  return input;
}

// --- Resource dropdowns for the "Run an action" panel ---
// Mirrors the flow-builder canvas's resource-loading logic so every module
// (sheets, calendar, drive, forms, Business Profile locations/reviews/
// posts, etc.) can be picked from a dropdown here too, instead of pasting
// IDs. Results are cached by resourceType + parent field values, so once
// something has been fetched once (e.g. "List accounts"), picking an action
// that needs that same ID later reuses the cached list instead of forcing
// another manual fetch.
const resourceCache = {}; // key: `${resourceType}|${depValuesJoined}` -> [{value,label}]

function dependsOnNames(dependsOn) {
  return (dependsOn || '').split(',').map(s => s.trim()).filter(Boolean);
}

function resourceCacheKey(resourceType, depNames, prefix) {
  const depVals = depNames.map(dep => {
    const el = document.getElementById(prefix + '_' + dep);
    return el ? el.value : '';
  });
  return `${resourceType}|${depVals.join('|')}`;
}

function cacheResourceOutput(resourceType, depNames, prefix, options) {
  resourceCache[resourceCacheKey(resourceType, depNames, prefix)] = options;
}

// Recognizes the shape of common list-action outputs and turns them into
// {value,label} dropdown options - used to seed the cache from whatever the
// person just fetched, not just from an explicit "Load options" click.
// `hintResourceType` disambiguates output shapes that can seed more than one
// dropdown - loadMails' `messages` array backs both a "pick a message"
// dropdown (value = message id, for markAsRead/addLabel) and a "pick a
// thread to reply in" dropdown (value = threadId, for reply); the raw
// output shape is the same, so the caller's declared resourceType decides
// which id gets used as the option value.
function optionsFromActionOutput(output, hintResourceType) {
  if (!output) return null;
  if (output.spreadsheets) return { resourceType: 'spreadsheet', options: output.spreadsheets.map(s => ({ value: s.id, label: s.name })) };
  if (output.sheets) return { resourceType: 'sheet', options: output.sheets.map(s => ({ value: s.title, label: s.title })) };
  if (output.calendars) return { resourceType: 'calendar', options: output.calendars.map(c => ({ value: c.id, label: c.name || c.summary })) };
  if (output.files) return { resourceType: 'driveFile', options: output.files.map(f => ({ value: f.id, label: f.name })) };
  if (output.folders) return { resourceType: 'driveFolder', options: output.folders.map(f => ({ value: f.id, label: f.name })) };
  if (output.forms) return { resourceType: 'form', options: output.forms.map(f => ({ value: f.id, label: f.name })) };
  if (output.documents) return { resourceType: 'document', options: output.documents.map(d => ({ value: d.id, label: d.name })) };
  if (output.options) return { resourceType: hintResourceType, options: output.options };
  if (output.labels) return { resourceType: 'gmailLabel', options: output.labels.map(l => ({ value: l.id, label: l.name })) };
  if (output.messages) return hintResourceType === 'gmailThread'
    ? { resourceType: 'gmailThread', options: output.messages.map(m => ({ value: m.threadId, label: `${m.from || ''} - ${m.subject || '(no subject)'}` })) }
    : { resourceType: 'gmailMessage', options: output.messages.map(m => ({ value: m.id, label: `${m.from || ''} - ${m.subject || '(no subject)'}` })) };
  if (output.accounts) return { resourceType: 'gbpAccount', options: output.accounts.map(a => ({ value: a.name, label: a.accountName || a.name })) };
  if (output.locations) return { resourceType: 'gbpLocation', options: output.locations.map(l => ({ value: l.name, label: l.title || l.name })) };
  if (output.reviews) return { resourceType: 'gbpReview', options: output.reviews.map(r => ({
    value: r.reviewId || r.name, label: `${r.reviewer?.displayName || 'Anonymous'} - ${(r.comment || '').slice(0, 40)}`,
  })) };
  if (output.posts) return { resourceType: 'gbpPost', options: output.posts.map(p => ({
    value: (p.name || '').split('/').pop() || p.name, label: (p.summary || p.name || '').slice(0, 50),
  })) };
  return null;
}

// The standard parent-field chain each resource type is fetched within -
// used to key the cache consistently regardless of which action produced
// the data (e.g. listLocations' output is keyed by the accountId it used,
// so a later field needing gbpLocation for that same account finds it).
const RESOURCE_DEPENDS = {
  spreadsheet: [], sheet: ['spreadsheetId'], calendar: [], driveFile: [], driveFolder: [],
  form: [], gbpAccount: [], gbpLocation: ['accountId'], gbpReview: ['accountId', 'locationId'], gbpPost: ['accountId', 'locationId'],
  document: [], gmailLabel: [], gmailMessage: [], gmailThread: [],
};

// Maps a dropdown's resourceType to the backend action that fetches it.
function resourceFetchPlan(resourceType) {
  switch (resourceType) {
    case 'spreadsheet': return { action: 'listSpreadsheets' };
    case 'sheet': return { action: 'listSheets' };
    case 'calendar': return { action: 'getCalendars' };
    case 'driveFile': return { action: 'getFiles' };
    case 'driveFolder': return { action: 'getFolders' };
    case 'form': return { action: 'listForms' };
    case 'gbpAccount': return { action: 'listAccounts' };
    case 'gbpLocation': return { action: 'listLocations' };
    case 'gbpReview': return { action: 'listReviews' };
    case 'gbpPost': return { action: 'listPosts' };
    case 'document': return { action: 'getDocuments' };
    case 'gmailLabel': return { action: 'listLabels' };
    case 'gmailMessage': return { action: 'loadMails' };
    case 'gmailThread': return { action: 'loadMails' };
    default: return null;
  }
}

async function loadResourceOptions(prefix, resourceType, dependsOnStr, fieldName, moduleName) {
  const selectEl = document.getElementById(prefix + '_' + fieldName);
  if (!selectEl) return;
  const connSel = document.getElementById(prefix === 'act' ? 'actionConnection' : (prefix + '_connectionId'));
  const connectionId = connSel ? connSel.value : '';
  if (!connectionId) { showMsg(document.getElementById('banner'), 'Choose a connected account before loading options.', 'error'); return; }

  const depNames = dependsOnNames(dependsOnStr);
  for (const dep of depNames) {
    const depEl = document.getElementById(prefix + '_' + dep);
    if (!depEl || !depEl.value) {
      showMsg(document.getElementById('banner'), `Select ${dep} first.`, 'error');
      return;
    }
  }
  const plan = resourceFetchPlan(resourceType);
  if (!plan) return;

  const originalHtml = selectEl.innerHTML;
  selectEl.innerHTML = '<option value="">Loading...</option>';
  selectEl.disabled = true;
  try {
    const inputPayload = {};
    depNames.forEach(dep => { inputPayload[dep] = document.getElementById(prefix + '_' + dep).value; });
    const res = await fetch(`${API}/api/${moduleName}/${plan.action}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ connectionId, input: inputPayload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to load options');

    const parsed = optionsFromActionOutput(data.output, resourceType) || { options: [] };
    cacheResourceOutput(resourceType, depNames, prefix, parsed.options);
    fillResourceSelect(selectEl, parsed.options);
    if (parsed.options.length === 0) showMsg(document.getElementById('banner'), 'No results found for that dropdown.', 'error');
  } catch (e) {
    selectEl.innerHTML = originalHtml;
    showMsg(document.getElementById('banner'), 'Error loading options: ' + e.message, 'error');
  } finally {
    selectEl.disabled = false;
  }
}

function fillResourceSelect(selectEl, options) {
  const currentVal = selectEl.value;
  selectEl.innerHTML = '<option value="">Select...</option>' +
    options.map(o => `<option value="${o.value}" ${o.value === currentVal ? 'selected' : ''}>${o.label}</option>`).join('');
}

// After rendering a set of resource fields, silently reuse anything already
// cached (e.g. from a previous "Run an action" fetch) so the person doesn't
// have to click "Load options" again for data already fetched.
function prefillCachedResourceFields(fields, prefix) {
  fields.filter(f => f.type === 'resource').forEach(f => {
    const depNames = dependsOnNames(f.dependsOn);
    const depsReady = depNames.every(dep => {
      const el = document.getElementById(prefix + '_' + dep);
      return el && el.value;
    });
    if (!depsReady) return;
    const key = resourceCacheKey(f.resourceType, depNames, prefix);
    const cached = resourceCache[key];
    if (cached) {
      const selectEl = document.getElementById(prefix + '_' + f.name);
      if (selectEl) fillResourceSelect(selectEl, cached);
    }
  });
}

function wireResourceFieldDelegation(containerId, prefix, getModuleName) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.resourceWired) return;
  container.dataset.resourceWired = '1';

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.load-resources-btn');
    if (!btn) return;
    const pfield = btn.closest('.field[data-resource-field]');
    loadResourceOptions(prefix, btn.dataset.resourceType, pfield ? pfield.dataset.dependsOn : '', btn.dataset.resourceField, getModuleName());
  });

  container.addEventListener('change', (e) => {
    const select = e.target.closest('select.resource-select');
    if (!select) return;
    const fieldName = select.id.slice(prefix.length + 1);
    const moduleName = getModuleName();
    const actionName = document.getElementById('actionName') ? document.getElementById('actionName').value : '';
    const fields = ACTION_FIELDS[actionName] || [];
    const dependents = fields.filter(f => dependsOnNames(f.dependsOn).includes(fieldName));
    dependents.forEach(dep => loadResourceOptions(prefix, dep.resourceType, dep.dependsOn, dep.name, moduleName));
  });
}

function fieldsHtml(fields, prefix) {
  return fields.map(f => `
    <div class="field" ${f.type === 'resource' ? `data-resource-field="${f.name}" data-resource-type="${f.resourceType}" data-depends-on="${f.dependsOn || ''}"` : ''}>
      <label>${f.label}</label>
      ${f.textarea
        ? `<textarea id="${prefix}_${f.name}" rows="3" style="width:100%; background:var(--panel); border:1px solid var(--border); color:var(--text); padding:8px; border-radius:6px; font-family:var(--sans);" placeholder="${f.placeholder||''}"></textarea>`
        : f.type === 'resource'
          ? `<select id="${prefix}_${f.name}" class="resource-select"><option value="">${f.placeholder || 'Select...'}</option></select><button type="button" class="tbtn load-resources-btn" data-resource-field="${f.name}" data-resource-type="${f.resourceType}" style="font-size:11px; padding:4px 8px; margin-top:6px;">↻ Load options</button>`
        : f.type === 'select'
          ? `<select id="${prefix}_${f.name}">${(f.options||[]).map(o => `<option value="${o}">${o}</option>`).join('')}</select>`
        : f.type === 'checkbox'
          ? `<input id="${prefix}_${f.name}" type="checkbox" />`
        : `<input id="${prefix}_${f.name}" type="${f.type||'text'}" placeholder="${f.placeholder||''}" />`}
    </div>`).join('');
}

// Called when the MODULE changes: the action list and connection list both
// depend on which module is selected, so both need to be rebuilt, then the
// input fields refreshed for whatever action ends up selected first.
function renderActionForm() {
  updateActionNameOptions();
  updateConnectionOptions();
  renderActionFields();
}

// Called when the ACTION NAME changes: only the input fields depend on this,
// not the module or connection lists. Rebuilding those <select> elements here
// would wipe out the very selection the user just made (no option carries a
// `selected` attribute, so re-rendering resets the dropdown to its first
// entry) - that was the "picking sendMail snaps back to loadMails" bug.
function renderActionFields() {
  const actionName = document.getElementById('actionName').value;
  const fields = ACTION_FIELDS[actionName] || [];
  document.getElementById('actionFormFields').innerHTML =
    `<h3>${actionName} inputs</h3>` + (fields.length ? fieldsHtml(fields, 'act') : '<div class="empty">No inputs required.</div>');
  prefillCachedResourceFields(fields, 'act');
}

async function runAction() {
  const moduleName = document.getElementById('actionModule').value;
  const actionName = document.getElementById('actionName').value;
  const connectionId = document.getElementById('actionConnection').value;
  const fields = ACTION_FIELDS[actionName] || [];
  const input = buildInputFromFields(fields, 'act');

  const outEl = document.getElementById('actionOutput');
  outEl.innerHTML = '<div class="output-box">Running...</div>';
  try {
    const res = await fetch(`${API}/api/${moduleName}/${actionName}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ connectionId, input })
    });
    const data = await res.json();
    outEl.innerHTML = `<div class="output-box">${JSON.stringify(data, null, 2)}</div>`;

    // If this run's output looks like a list of resources (accounts,
    // locations, reviews, posts, spreadsheets, sheets, calendars, files,
    // forms...), cache it so the next action you pick can reuse it in its
    // dropdown instead of you having to fetch it again.
    const parsed = optionsFromActionOutput(data.output);
    if (parsed) {
      cacheResourceOutput(parsed.resourceType, RESOURCE_DEPENDS[parsed.resourceType] || [], 'act', parsed.options);
    }
  } catch (e) {
    outEl.innerHTML = `<div class="msg error">${e.message}</div>`;
  }
}

// --- Flow builder (simple ordered list, not a canvas) ---

function addStep() {
  stepDrafts.push({ module: modulesCache[0]?.name || '', action: '', connectionId: '', input: {} });
  renderStepBuilder();
}

function removeStep(i) {
  stepDrafts.splice(i, 1);
  renderStepBuilder();
}

function renderStepBuilder() {
  const el = document.getElementById('stepBuilder');
  el.innerHTML = stepDrafts.map((s, i) => {
    const mod = modulesCache.find(m => m.name === s.module) || modulesCache[0];
    const actions = mod ? mod.actions : [];
    const conns = connectionsCache.filter(c => c.provider === (mod ? mod.provider : ''));
    const fields = ACTION_FIELDS[s.action] || [];
    const prefix = `step${i}`;
    return `
      <div class="step" data-step-index="${i}">
        <div class="step-head"><span>STEP ${i+1}</span><button class="btn small danger" data-remove-step="${i}">remove</button></div>
        <select data-step-field="module" data-step-index="${i}">
          ${modulesCache.map(m => `<option value="${m.name}" ${m.name===s.module?'selected':''}>${m.name}</option>`).join('')}
        </select>
        <select data-step-field="action" data-step-index="${i}">
          <option value="">choose action</option>
          ${actions.map(a => `<option value="${a}" ${a===s.action?'selected':''}>${a}</option>`).join('')}
        </select>
        <select id="${prefix}_connectionId" data-step-field="connectionId" data-step-index="${i}">
          <option value="">choose connection</option>
          ${conns.map(c => `<option value="${c.id}" ${c.id===s.connectionId?'selected':''}>${c.account_label}</option>`).join('')}
        </select>
        ${fields.length ? fieldsHtml(fields, prefix) : ''}
        ${fields.length && i > 0 ? '<div class="hint" style="margin-top:4px;">Dropdowns fetch fresh each step - or reference a prior step\'s output directly below.</div>' : ''}
      </div>`;
  }).join('') || '<div class="empty">No steps yet.</div>';
  stepDrafts.forEach((s, i) => prefillCachedResourceFields(ACTION_FIELDS[s.action] || [], `step${i}`));
}

// Event delegation for the step builder - content is fully replaced on
// every render, so listeners are attached once on the stable parent.
function wireStepBuilderDelegation() {
  const el = document.getElementById('stepBuilder');

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-step]');
    if (btn) { removeStep(Number(btn.dataset.removeStep)); return; }

    const loadBtn = e.target.closest('.load-resources-btn');
    if (loadBtn) {
      const stepEl = e.target.closest('[data-step-index]');
      const i = Number(stepEl.dataset.stepIndex);
      const pfield = loadBtn.closest('.field[data-resource-field]');
      loadResourceOptions(`step${i}`, loadBtn.dataset.resourceType, pfield ? pfield.dataset.dependsOn : '', loadBtn.dataset.resourceField, stepDrafts[i].module);
    }
  });

  el.addEventListener('change', (e) => {
    const select = e.target.closest('select[data-step-field]');
    if (select) {
      const i = Number(select.dataset.stepIndex);
      const field = select.dataset.stepField;
      stepDrafts[i][field] = select.value;
      if (field === 'module') stepDrafts[i].action = '';
      if (field === 'module' || field === 'action') renderStepBuilder();
      return;
    }

    // Resource dropdowns and everything else fieldsHtml renders share the
    // `step{i}_{fieldName}` id scheme - route by parsing that id.
    const target = e.target.closest('[id^="step"]');
    if (target && /^step(\d+)_(.+)$/.test(target.id)) {
      const [, iStr, fieldName] = target.id.match(/^step(\d+)_(.+)$/);
      const i = Number(iStr);
      stepDrafts[i].input[fieldName] = target.type === 'checkbox' ? target.checked : target.value;

      // Selecting a resource this step's other fields depend on reloads them.
      if (target.classList.contains('resource-select')) {
        const fields = ACTION_FIELDS[stepDrafts[i].action] || [];
        const dependents = fields.filter(f => dependsOnNames(f.dependsOn).includes(fieldName));
        dependents.forEach(dep => loadResourceOptions(`step${i}`, dep.resourceType, dep.dependsOn, dep.name, stepDrafts[i].module));
      }
    }
  });

  el.addEventListener('input', (e) => {
    const target = e.target;
    if (!target.id || target.tagName === 'SELECT') return;
    const m = target.id.match(/^step(\d+)_(.+)$/);
    if (!m) return;
    stepDrafts[Number(m[1])].input[m[2]] = target.value;
  });
}

async function saveFlow() {
  const name = document.getElementById('flowName').value.trim();
  if (!name) return alert('Name your flow first.');
  const steps = stepDrafts.filter(s => s.module && s.action && s.connectionId).map(s => {
    const fields = ACTION_FIELDS[s.action] || [];
    const inputMap = {};
    fields.forEach(f => {
      const raw = s.input[f.name];
      if (raw === undefined || raw === '') return;
      setPath(inputMap, f.path || f.name, parseFieldValue(f, raw));
    });
    return { module: s.module, action: s.action, connectionId: s.connectionId, inputMap };
  });
  if (steps.length === 0) return alert('Add at least one complete step.');

  const res = await fetch(API + '/flows', { method: 'POST', headers: headers(), body: JSON.stringify({ name, steps }) });
  const data = await res.json();
  if (!res.ok) return alert(data.message || data.error);
  document.getElementById('flowName').value = '';
  stepDrafts = [];
  addStep();
  await loadFlows();
}

async function loadFlows() {
  const res = await fetch(API + '/flows', { headers: headers() });
  if (!res.ok) return;
  const data = await res.json();
  const el = document.getElementById('flowList');
  el.innerHTML = (data.flows || []).map(f => `
    <div class="flow-item">
      <div>${f.name} <span class="conn-label">(${(f.sm_flow_steps||[]).length} steps)</span></div>
      <div>
        <button class="btn small" data-run-flow="${f.id}">run</button>
        <button class="btn small danger" data-delete-flow="${f.id}">delete</button>
      </div>
    </div>`).join('') || '<div class="empty">No flows saved yet.</div>';
}

function wireFlowListDelegation() {
  const el = document.getElementById('flowList');
  el.addEventListener('click', (e) => {
    const runBtn = e.target.closest('[data-run-flow]');
    if (runBtn) return runFlowNow(runBtn.dataset.runFlow);
    const delBtn = e.target.closest('[data-delete-flow]');
    if (delBtn) return deleteFlow(delBtn.dataset.deleteFlow);
  });
}

function wireModuleListDelegation() {
  const el = document.getElementById('moduleList');
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-connect-module]');
    if (btn) return connectModule(btn.dataset.connectModule);
    const xBtn = e.target.closest('[data-disconnect]');
    if (xBtn) return disconnectConnection(xBtn.dataset.disconnect);
  });
}

async function runFlowNow(id) {
  const res = await fetch(`${API}/flows/${id}/run`, { method: 'POST', headers: headers() });
  const data = await res.json();
  alert(`Run ${data.status}` + (data.error ? `: ${data.error}` : ''));
}

async function deleteFlow(id) {
  await fetch(`${API}/flows/${id}`, { method: 'DELETE', headers: headers() });
  await loadFlows();
}

// --- init: wire all static button listeners (CSP forbids inline handlers) ---
function init() {
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('registerBtn').addEventListener('click', register);
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('toggleToPasteBtn').addEventListener('click', () => showPanel('paste'));
  document.getElementById('toggleToLoginBtn').addEventListener('click', () => showPanel('login'));
  document.getElementById('usePastedKeyBtn').addEventListener('click', usePastedKey);
  document.getElementById('toggleToRegisterBtn').addEventListener('click', () => showPanel('register'));
  document.getElementById('toggleToRegisterFromLoginBtn').addEventListener('click', () => showPanel('register'));

  document.getElementById('actionModule').addEventListener('change', renderActionForm);
  document.getElementById('actionName').addEventListener('change', renderActionFields);
  document.getElementById('runActionBtn').addEventListener('click', runAction);
  wireResourceFieldDelegation('actionFormFields', 'act', () => document.getElementById('actionModule').value);

  document.getElementById('addStepBtn').addEventListener('click', addStep);
  document.getElementById('saveFlowBtn').addEventListener('click', saveFlow);

  wireModuleListDelegation();
  wireStepBuilderDelegation();
  wireFlowListDelegation();

  if (apiKey) enterDashboard();
}

document.addEventListener('DOMContentLoaded', init);