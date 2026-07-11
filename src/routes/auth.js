const express = require('express');
const bcrypt = require('bcryptjs');
const { supabase, TABLES } = require('../lib/supabase');
const { generateApiKey } = require('../lib/encryption');
const logger = require('../lib/logger');

const router = express.Router();

// POST /auth/register { email, password }
// Bootstraps a user and issues their first API key. The raw key is
// returned exactly once here - after this, only its hash exists in
// storage. Losing it means generating a new one (an /auth/keys/rotate
// endpoint is a natural next addition, not included in this starter).
router.post('/register', express.json(), async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: 'invalid_input', message: 'email and password (8+ chars) required' });
    }

    const { data: existing } = await supabase.from(TABLES.USERS).select('id').eq('email', email).maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'email_taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { data: user, error: userError } = await supabase
      .from(TABLES.USERS)
      .insert({ email, password_hash: passwordHash })
      .select('id, email')
      .single();

    if (userError) throw userError;

    const { raw, hash } = generateApiKey();
    const { error: keyError } = await supabase
      .from(TABLES.API_KEYS)
      .insert({ user_id: user.id, key_hash: hash, label: 'default' });

    if (keyError) throw keyError;

    res.status(201).json({ user, apiKey: raw, message: 'Save this API key now - it will not be shown again.' });
  } catch (err) {
    logger.error({ err }, '[auth] register failed');
    next(err);
  }
});

// POST /auth/login { email, password }
// Verifies credentials, then issues a brand new API key (raw keys can't be
// recovered once shown - only their hash is stored - so "logging in" means
// getting a fresh key, not retrieving the old one). Existing keys for this
// user are untouched and keep working.
router.post('/login', express.json(), async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const { data: user, error } = await supabase
      .from(TABLES.USERS)
      .select('id, email, password_hash')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const { raw, hash } = generateApiKey();
    const { error: keyError } = await supabase
      .from(TABLES.API_KEYS)
      .insert({ user_id: user.id, key_hash: hash, label: 'login' });

    if (keyError) throw keyError;

    res.json({
      user: { id: user.id, email: user.email },
      apiKey: raw,
      message: 'New API key issued - save it now, it will not be shown again.',
    });
  } catch (err) {
    logger.error({ err }, '[auth] login failed');
    next(err);
  }
});

module.exports = router;
