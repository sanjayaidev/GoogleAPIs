const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

// IMPORTANT: service_role key bypasses Row Level Security.
// This client must NEVER be exposed to the frontend. It only ever runs
// inside this backend. All row-level user scoping (user_id = ...) must be
// done explicitly in every query below - Supabase will not do it for us.
const supabase = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

// Table names, all prefixed with sm_ as decided.
const TABLES = {
  USERS: 'sm_users',
  API_KEYS: 'sm_api_keys',
  CONNECTIONS: 'sm_connections',
  FLOWS: 'sm_flows',
  FLOW_STEPS: 'sm_flow_steps',
  FLOW_RUNS: 'sm_flow_runs',
};

module.exports = { supabase, TABLES };
