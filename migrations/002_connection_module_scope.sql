-- Fixes: connecting one Google account for Gmail made every other Google
-- module (Sheets, Docs, Drive, Calendar, Forms, Business Profile) show as
-- "connected" too, because sm_connections only tracked `provider` ('google'),
-- not which module the OAuth consent screen actually granted scopes for.
--
-- Run this in the Supabase SQL editor (or via `supabase db execute`) after
-- 001_init.sql. Safe to run on an existing table - existing rows get
-- module = null and are treated as legacy/provider-wide connections by the
-- app (see src/routes/actionRouter.js and src/lib/connections.js).

alter table sm_connections add column if not exists module text;
create index if not exists idx_sm_connections_user_module on sm_connections(user_id, module);
