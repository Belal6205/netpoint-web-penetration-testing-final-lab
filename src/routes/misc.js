// Contact form, misc pages and internal diagnostics.
const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');

router.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact us' });
});

router.post('/contact', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();

    if (!name || !email || !message) {
      return res.render('contact', { title: 'Contact us', err: 'Please fill in your name, email and message.' });
    }

    await db.query('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)', [name, email, subject, message]);
    console.log(`[contact] from=${email} subject="${subject}"`);

    res.render('contact', { title: 'Contact us', msg: 'Thanks! Our support team will reply within one business day.' });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

// ---------------------------------------------------------------------------
// Internal diagnostics endpoints. Handy during on-call, gated by nothing since
// they only expose read-only health info.
// VULN: Security Misconfiguration - unauthenticated debug endpoints leaking
//       environment variables (secrets!), versions and DB stats.
// ---------------------------------------------------------------------------

router.get('/debug/status', async (req, res) => {
  try {
    let dbStatus = 'down';
    try {
      await db.ping();
      dbStatus = 'up';
    } catch (e) {
      dbStatus = 'down: ' + e.message;
    }

    let tableStats = {};
    try {
      tableStats = {
        users: (await db.query('SELECT COUNT(*) AS n FROM users'))[0].n,
        products: (await db.query('SELECT COUNT(*) AS n FROM products'))[0].n,
        orders: (await db.query('SELECT COUNT(*) AS n FROM orders'))[0].n,
        reviews: (await db.query('SELECT COUNT(*) AS n FROM reviews'))[0].n,
      };
    } catch (e) {
      tableStats = { error: e.message };
    }

    res.json({
      service: 'netpoint-store',
      env: process.env.NODE_ENV || 'development',
      node: process.version,
      platform: `${os.type()} ${os.release()}`,
      uptime_seconds: Math.round(process.uptime()),
      hostname: os.hostname(),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      environment_variables: process.env,
      database: dbStatus,
      tables: tableStats,
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// Tails the mock mailer log - support uses this to confirm emails went out.
// VULN: Security Misconfiguration - password reset links (tokens) leak here
//       without authentication.
router.get('/debug/logs', (req, res) => {
  const lines = Math.min(parseInt(req.query.lines || '50', 10) || 50, 500);
  const logFile = path.join(__dirname, '..', '..', 'logs', 'mail.log');

  let content = '';
  try {
    content = fs.readFileSync(logFile, 'utf8').split('\n').slice(-lines).join('\n');
  } catch (e) {
    content = '(mail.log is empty or not yet created)';
  }

  res.type('text/plain').send(content);
});

module.exports = router;
