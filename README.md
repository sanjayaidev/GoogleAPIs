# sm-server

Module-based API gateway for Google + Meta services. Each provider is a self-contained
module file (`src/modules/gmail.js`, etc.) exposing a fixed set of actions and triggers.
Your own API key authenticates every call; OAuth connections are stored in Supabase (add DB-level encryption/RLS if you need tokens encrypted at rest - see note below).

## What's included in this starter

- Express server with helmet, CORS, structured logging (pino)
- **Dashboard UI served from this same app** (`/public/index.html`) - register/paste an API
  key, connect Gmail, click-run actions, build and run simple linear flows. No separate
  frontend project needed.
- API key auth middleware (hash-based lookup, never stores raw keys)
- Per-key rate limiting
- Supabase REST client (service_role, server-only) - `sm_` prefixed tables
- Generic action router: `POST /api/:module/:action` dispatches to any registered module
- Google OAuth flow: `/oauth/google/start` and `/oauth/google/callback` (state CSRF protected,
  proactive token refresh with a 5-min buffer)
- Meta webhook receiver with signature verification (`/webhooks/meta`), plus a generic
  webhook endpoint for things like Apps Script bound triggers (`/webhooks/generic/:source`)
- Keep-alive self-ping (node-cron) to stop Render free tier from idling out
- Auth routes: `POST /auth/register`, `POST /auth/login`
- Connections: `GET /connections`, `DELETE /connections/:id`
- Flows: `GET /flows`, `POST /flows`, `POST /flows/:id/run`, `DELETE /flows/:id` - the
  linear for-loop runner (`src/lib/flowRunner.js`), no engine, no branching graph, just
  sequential action calls with simple field-mapping and skip conditions
- One fully-working module: **Gmail** (loadMails, sendMail, createDraft, reply, markAsRead,
  addLabel, + a newMail poll trigger)
- Six more modules, same shape, same OAuth flow: **Calendar**, **Sheets**, **Docs**, **Drive**,
  **Forms**, and **Google Business Profile** - see below for scopes and access notes.

## Using the dashboard

1. Start the server, open `http://localhost:3000` (or your Render URL) in a browser.
2. Register an account - you'll get an API key shown once. It's saved in the browser's
   localStorage automatically so you won't need to paste it again on that device.
3. Click **connect** next to the Gmail module - this runs the real OAuth flow and redirects
   back once authorized.
4. Use **Run an action** to test single calls (send mail, load mails, etc.) against your
   connected account.
5. Use **Flow builder** to chain a few actions into a saved, ordered sequence, then hit
   **run** on it from the flows list.

### Connected accounts are scoped per module

Each "Connect" click stores which module the OAuth grant was for (`sm_connections.module`).
Connecting Gmail does **not** make Sheets/Docs/Drive/Calendar/Forms/Business Profile show as
connected too - each module lists only the accounts explicitly connected for it, and you can
connect multiple accounts per module and pick which one a given action/flow-node uses. Click the
**×** on an account chip (module bar, classic dashboard, or a flow node's properties panel) to
disconnect that specific account - `DELETE /connections/:id`.

### Flow builder canvas

The flow builder (`/flow-builder.html`) is a node-graph editor in the style of n8n:

- **Zoom**: mouse wheel, the +/− buttons, or `+` / `-` / `0` (reset) keys
- **Pan**: click-drag empty canvas
- **Add a node**: click a module card, or press `Tab` for a searchable quick-add panel
- **Remove a node**: the node's × button, or select it and press `Delete`/`Backspace`
- **Connect/disconnect nodes**: drag from a node's output socket (right) to another node's
  input socket (left) to wire them; click a connector's × to remove it
- **Run order**: derived by walking the connector graph from the trigger node - the backend
  flow runner is still strictly linear (see below), so all nodes must end up in one connected
  chain from the trigger before you can save

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in real values:
   - Create a Supabase project, grab the URL + `service_role` key (Settings > API)
   - OAuth tokens are stored as plain text in `sm_connections` by design (no app-level
     `ENCRYPTION_KEY` anymore) - add encryption at the database layer (e.g. `pgcrypto`
     column encryption, Supabase Vault, or disk-level encryption) if you need tokens
     encrypted at rest; the app writes/reads them as plain strings either way.
   - Create a Google Cloud project, OAuth consent screen + credentials (Web application),
     add `GOOGLE_REDIRECT_URI` as an authorized redirect URI
   - Create a Meta App if/when you add the Meta module, set up webhook subscription
3. Run the migrations, in order, in the Supabase SQL editor: `migrations/001_init.sql` then
   `migrations/002_connection_module_scope.sql` (adds the `module` column connections are
   scoped by - see "Connected accounts are scoped per module" above).
4. `npm run dev` (or `npm start`)

## Trying it out locally

```bash
# 1. Create a user + api key row manually in Supabase for now (a signup route
#    isn't included in this starter - add one when you build the frontend).

# 2. Start a Google connection (requires a valid API key as Bearer token):
curl "http://localhost:3000/oauth/google/start?module=gmail" \
  -H "Authorization: Bearer sm_live_xxxx"
# -> { authUrl: "https://accounts.google.com/o/oauth2/..." }
# Open that URL in a browser, approve, get redirected to /oauth/google/callback,
# which stores the connection and redirects to /connected?...

# 3. Call an action:
curl -X POST http://localhost:3000/api/gmail/sendMail \
  -H "Authorization: Bearer sm_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "<uuid from sm_connections>",
    "input": { "to": "someone@example.com", "subject": "Hi", "body": "Test" }
  }'
```

## Modules

Every module follows the same shape: `{ provider, requiredScopes, actions: {...}, triggers: {...} }`.
The OAuth flow automatically requests exactly the scopes a module declares (plus a base
`userinfo.email` scope used to label the connection), nothing more.

| Module | Actions | Scopes |
|---|---|---|
| `gmail` | loadMails, sendMail, createDraft, reply, markAsRead, addLabel | gmail.readonly, gmail.send, gmail.modify |
| `calendar` | listCalendars, listEvents, createEvent, updateEvent, deleteEvent | calendar.events, calendar.readonly |
| `sheets` | createSpreadsheet, readRange, appendRow, updateRange, clearRange | spreadsheets |
| `docs` | createDocument, getDocument, appendText, replaceAllText | documents |
| `drive` | listFiles, getFile, uploadFile, createFolder, deleteFile, shareFile | drive (full - narrow to `drive.file` if you don't need to touch a user's existing files) |
| `forms` | createForm, getForm, addQuestion, listResponses | forms.body, forms.responses.readonly |
| `googleBusinessProfile` | listAccounts, listLocations, getLocation, getDailyMetrics, listReviews, replyToReview, deleteReviewReply | business.manage |

**Google Business Profile access is gated separately from OAuth.** Unlike the other modules,
these APIs are *not* open by default on a new Google Cloud project - you must submit an access
request (Business Profile APIs → request access), show a legitimate use case, and have a
Business Profile that's been verified and active for 60+ days with a matching business website.
Approval typically takes days to weeks. Until then, calls will fail with a permission error even
with valid tokens and the right scope. Reviews specifically live on the legacy
`mybusiness.googleapis.com/v4` REST surface (not bundled in the `googleapis` npm package, so
`googleBusinessProfile.js` calls it directly via the OAuth2 client) - Google has kept this one
API version active for reviews/posts even though everything else moved to the split APIs.

Also worth knowing: `forms.responses.readonly` and `forms.body` are Google *restricted* scopes,
which means a production OAuth app (past 100 test users) needs to go through Google's sensitive-
scope verification before general users can connect. `drive` (full) is similarly restricted.

## Adding another module

1. Create `src/modules/<name>.js` following the exact same shape as `gmail.js`:
   `{ provider, requiredScopes, actions: {...}, triggers: {...} }`
2. Register it in `src/modules/index.js` (one line).
3. If it needs dashboard support for input fields with array/object shapes (not just flat
   strings/numbers), add entries to `ACTION_FIELDS` in `public/js/app.js` - use dot-path names
   like `"start.dateTime"` for nested objects, or `json: true` on a field for array/object input
   parsed from a JSON textarea (see `calendar`'s `createEvent` and `sheets`'s `appendRow` for
   examples of each).
4. Nothing else changes - the action router, OAuth flow, and rate limiter all work
   generically against any module in the registry.

## Keep-alive

`ENABLE_SELF_PING=true` (default) makes the server ping its own `/health` every
`SELF_PING_CRON` (default every 10 min) so Render's free tier doesn't spin it down
from inactivity. If you'd rather use an external pinger (cron-job.org, UptimeRobot,
a GitHub Actions schedule) hitting `/health` every ~14 min instead, set
`ENABLE_SELF_PING=false` and don't run both at once.

## Not included yet (next build steps)

- Meta module + Meta OAuth connect flow (Gmail's `/oauth/google/*` is the pattern to copy)
- Scheduled trigger runner (node-cron per active flow, or a shared cron sweep) - the poll
  functions on each module's `triggers` are written and ready, nothing calls them on a schedule yet
- API key rotation/revocation endpoints beyond what `/auth/login` now provides (it issues a
  fresh key on successful login; there's no explicit "revoke this specific key" endpoint yet)
