# sm-server

Module-based API gateway for Google + Meta services. Each provider is a self-contained
module file (`src/modules/gmail.js`, etc.) exposing a fixed set of actions and triggers.
Your own API key authenticates every call; OAuth connections are stored encrypted in Supabase.

## What's included in this starter

- Express server with helmet, CORS, structured logging (pino)
- API key auth middleware (hash-based lookup, never stores raw keys)
- Per-key rate limiting
- AES-256-GCM encryption for OAuth tokens at rest
- Supabase REST client (service_role, server-only) - `sm_` prefixed tables
- Generic action router: `POST /api/:module/:action` dispatches to any registered module
- Google OAuth flow: `/oauth/google/start` and `/oauth/google/callback` (state CSRF protected,
  proactive token refresh with a 5-min buffer)
- Meta webhook receiver with signature verification (`/webhooks/meta`), plus a generic
  webhook endpoint for things like Apps Script bound triggers (`/webhooks/generic/:source`)
- Keep-alive self-ping (node-cron) to stop Render free tier from idling out
- One fully-working module: **Gmail** (loadMails, sendMail, createDraft, reply, markAsRead,
  addLabel, + a newMail poll trigger)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in real values:
   - Generate `ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - Create a Supabase project, grab the URL + `service_role` key (Settings > API)
   - Create a Google Cloud project, OAuth consent screen + credentials (Web application),
     add `GOOGLE_REDIRECT_URI` as an authorized redirect URI
   - Create a Meta App if/when you add the Meta module, set up webhook subscription
3. Run the migration: open `migrations/001_init.sql` in the Supabase SQL editor and execute it.
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
# which stores the encrypted connection and redirects to /connected?...

# 3. Call an action:
curl -X POST http://localhost:3000/api/gmail/sendMail \
  -H "Authorization: Bearer sm_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "<uuid from sm_connections>",
    "input": { "to": "someone@example.com", "subject": "Hi", "body": "Test" }
  }'
```

## Adding a new module (e.g. Calendar)

1. Create `src/modules/calendar.js` following the exact same shape as `gmail.js`:
   `{ provider, requiredScopes, actions: {...}, triggers: {...} }`
2. Register it in `src/modules/index.js` (one line).
3. Nothing else changes - the action router, OAuth flow, and rate limiter all work
   generically against any module in the registry.

## Keep-alive

`ENABLE_SELF_PING=true` (default) makes the server ping its own `/health` every
`SELF_PING_CRON` (default every 10 min) so Render's free tier doesn't spin it down
from inactivity. If you'd rather use an external pinger (cron-job.org, UptimeRobot,
a GitHub Actions schedule) hitting `/health` every ~14 min instead, set
`ENABLE_SELF_PING=false` and don't run both at once.

## Not included yet (next build steps)

- Flow model (`sm_flows` / `sm_flow_steps` / `sm_flow_runs` tables already exist in the
  migration) + the linear flow runner that chains action calls together
- Signup/login + your own API key issuance endpoint (currently: insert rows manually)
- Calendar, Sheets, Docs, Slides, Meta modules (Gmail is the reference implementation)
- Scheduled trigger runner (node-cron per active flow, or a shared cron sweep)
- Meta OAuth connect flow (Gmail's `/oauth/google/*` is the pattern to copy)
