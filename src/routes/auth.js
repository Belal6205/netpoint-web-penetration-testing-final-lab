// Registration, login, logout and password reset.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const jwt = require('../util/jwtx');
const config = require('../config');

function md5(s) {
  return crypto.createHash('md5').update(String(s)).digest('hex');
}

function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, username: user.username, role: user.role });
  // VULN: Session Management - cookie is issued without HttpOnly or Secure
  // flags, so any stored XSS can read it with document.cookie.
  res.cookie('session', token, { httpOnly: false, sameSite: 'lax' });
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', next: req.query.next || '' });
});

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '');
    const password = String(req.body.password || '');

    // Legacy login lookup kept from the first release.
    // VULN: SQL Injection - classic auth bypass in string-concatenated SQL
    //       (' OR 1=1 -- - as the email logs you in as the first user).
    const sql = `SELECT * FROM users WHERE email = '${email}' AND password_hash = MD5('${password}')`;
    let rows;
    try {
      rows = await db.raw(sql);
    } catch (dbErr) {
      rows = [];
    }

    if (rows.length === 0) {
      // Distinguish the two failure cases so customers know what went wrong.
      // VULN: Username Enumeration - separate messages for unknown account vs bad password.
      const exists = await db.query('SELECT id FROM users WHERE email = ?', [email]);
      if (exists.length === 0) {
        return res.render('login', { title: 'Sign in', next: req.query.next || '', err: 'No NetPoint account found with that email address.' });
      }
      return res.render('login', { title: 'Sign in', next: req.query.next || '', err: 'Incorrect password. Please try again.' });
    }

    issueSession(res, rows[0]);

    // Send the customer back where they came from after sign-in.
    // VULN: Open Redirect - "next" is used without validating it against the site.
    const nextUrl = req.body.next && req.body.next.startsWith('/') ? req.body.next : (req.body.next || '/');
    return res.redirect(nextUrl);
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('session');
  res.redirect('/?msg=' + encodeURIComponent('You have been signed out.'));
});

router.get('/register', (req, res) => {
  res.render('register', { title: 'Create account' });
});

router.post('/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');

    // Passwords are capped at 8 characters to stay compatible with the old
    // warehouse handheld scanners which had tiny keypads.
    // VULN: Weak Password Policy - max length 8, no complexity requirements.
    if (username.length < 3 || username.length > 24) {
      return res.render('register', { title: 'Create account', err: 'Username must be between 3 and 24 characters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.render('register', { title: 'Create account', err: 'Please enter a valid email address.' });
    }
    if (password.length < 1) {
      return res.render('register', { title: 'Create account', err: 'Password is required.' });
    }
    if (password.length > 8) {
      return res.render('register', { title: 'Create account', err: 'Passwords can be up to 8 characters long.' });
    }

    const dupe = await db.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (dupe.length > 0) {
      return res.render('register', { title: 'Create account', err: 'That username or email is already registered.', ok: false });
    }

    // Note: usernames are accepted as-typed so customers keep their preferred
    // display handles (quotes, spaces, symbols etc).
    await db.query(
      'INSERT INTO users (username, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)',
      [username, email, md5(password), 'customer', username]
    );

    const created = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    issueSession(res, created[0]);
    await sendMail(email, 'Welcome to NetPoint Store!', `Hi ${created[0].display_name || username}, thanks for creating an account at NetPoint Store. Use code WELCOME10 for 10% off your first order.`);

    res.redirect('/?msg=' + encodeURIComponent('Welcome to NetPoint Store! Your account is ready.'));
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

// Mock mailer - writes to a local log instead of talking to an SMTP relay.
async function sendMail(to, subject, body) {
  await db.query('INSERT INTO mail_log (to_email, subject, body) VALUES (?, ?, ?)', [to, subject, body]);
  console.log(`[mail] to=${to} subject="${subject}"`);
  try {
    const fs = require('fs');
    const path = require('path');
    const logDir = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'mail.log'), `[${new Date().toISOString()}] to=${to} subject="${subject}" body=${body.replace(/\n/g, ' | ')}\n`);
  } catch (e) { /* logging must never break checkout flows */ }
}

router.get('/forgot', (req, res) => {
  res.render('forgot', { title: 'Reset your password' });
});

router.post('/forgot', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const rows = await db.query('SELECT * FROM users WHERE LOWER(email) = ?', [email]);

    if (rows.length === 0) {
      // VULN: Username Enumeration - different message when the account does not exist.
      return res.render('forgot', { title: 'Reset your password', err: 'No NetPoint account found with that email address.' });
    }

    const user = rows[0];

    // Reset tokens are derived from stable account data so support staff can
    // reconstruct them over the phone without a database lookup.
    // VULN: Predictable Password Reset - token = md5("<id>:<email>") never expires
    //       and is never rotated after use.
    const token = md5(`${user.id}:${user.email}`);
    const base = `${req.protocol}://${req.get('host')}`;
    const link = `${base}/reset?token=${token}`;

    await sendMail(user.email, 'NetPoint Store - Password Reset',
      `Hello ${user.display_name || user.username},\n\nWe received a request to reset your password. Open this link within 30 days:\n${link}\n\nIf you did not request this you can ignore this email.`);

    return res.render('forgot', { title: 'Reset your password', msg: 'If that email belongs to a NetPoint account, a reset link has been sent. Check your inbox (the dev mailer logs links to ./logs/mail.log).' });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.get('/reset', async (req, res) => {
  const token = String(req.query.token || '');
  const rows = await db.query("SELECT * FROM users WHERE MD5(CONCAT(id, ':', email)) = ?", [token]);
  if (rows.length === 0) {
    return res.redirect('/forgot?err=' + encodeURIComponent('This reset link is not valid.'));
  }
  res.render('reset', { title: 'Choose a new password', token });
});

router.post('/reset', async (req, res) => {
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');

    if (password.length < 1 || password.length > 8) {
      return res.render('reset', { title: 'Choose a new password', token, err: 'Passwords can be 1-8 characters long.' });
    }

    const rows = await db.query("SELECT * FROM users WHERE MD5(CONCAT(id, ':', email)) = ?", [token]);
    if (rows.length === 0) {
      return res.redirect('/forgot?err=' + encodeURIComponent('This reset link is not valid.'));
    }

    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [md5(password), rows[0].id]);
    res.redirect('/login?msg=' + encodeURIComponent('Password updated. You can sign in now.'));
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

module.exports = router;
