-- Run this in the Supabase SQL editor (or via `supabase db execute`).
-- All tables prefixed sm_ as decided.

create table if not exists sm_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sm_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sm_users(id) on delete cascade,
  key_hash text unique not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists idx_sm_api_keys_user on sm_api_keys(user_id);

create table if not exists sm_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sm_users(id) on delete cascade,
  provider text not null check (provider in ('google', 'meta')),
  account_label text,
  access_token text not null,   -- encrypted (AES-256-GCM), never plaintext
  refresh_token text not null,  -- encrypted
  expires_at timestamptz not null,
  scopes text[] default '{}',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  created_at timestamptz not null default now()
);
create index if not exists idx_sm_connections_user on sm_connections(user_id);

create table if not exists sm_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sm_users(id) on delete cascade,
  name text not null,
  trigger_type text not null check (trigger_type in ('manual', 'schedule', 'webhook')),
  trigger_config jsonb default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_sm_flows_user on sm_flows(user_id);

create table if not exists sm_flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references sm_flows(id) on delete cascade,
  order_index int not null,
  module text not null,
  action text not null,
  connection_id uuid references sm_connections(id),
  input_map jsonb default '{}',
  condition jsonb, -- nullable: {field, operator, value, skip_to_step_id}
  created_at timestamptz not null default now()
);
create index if not exists idx_sm_flow_steps_flow on sm_flow_steps(flow_id);

create table if not exists sm_flow_runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references sm_flows(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  step_results jsonb default '{}',
  error text
);
create index if not exists idx_sm_flow_runs_flow on sm_flow_runs(flow_id);

-- Enable RLS with deny-by-default on all tables. The Node server uses the
-- service_role key which bypasses RLS entirely, so this changes nothing
-- for the app's normal operation - it's a safety net in case any other
-- key (anon, or a future leaked key) ever touches these tables directly.
alter table sm_users enable row level security;
alter table sm_api_keys enable row level security;
alter table sm_connections enable row level security;
alter table sm_flows enable row level security;
alter table sm_flow_steps enable row level security;
alter table sm_flow_runs enable row level security;
-- No policies created = no access via anon/authenticated roles, by design.
