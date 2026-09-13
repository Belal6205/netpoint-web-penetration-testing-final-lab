// Customer profile: personal info, avatar, password.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');
const { legacyUploadSingle } = require('../middleware/upload');

function md5(s) {
  return crypto.createHash('md5').update(String(s)).digest('hex');
}

router.get('/profile', requireLogin, async (req, res) => {
  try {
    // Account activity summary card.
    // VULN: SQL Injection (second-order) - the username was safely stored at
    //       registration but is concatenated here, so a username registered
    //       as `' OR SLEEP(5)-- -` fires when this page loads.
    const stats = await db.raw(
      `SELECT COUNT(*) AS order_count FROM orders o JOIN users u ON u.id = o.user_id WHERE u.username = '${req.user.username}'`
    );

    res.render('profile', { title: 'My profile', me: req.user, stats: stats[0] });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

// Save profile edits. The SPA posts the whole form including the account id.
// VULN: Broken Access Control (IDOR/mass assignment) - body.id decides whose
//       row is updated, and every submitted column is written, including
//       role/balance/points (self-service privilege escalation).
router.post('/profile/update', requireLogin, async (req, res) => {
  try {
    const allowedFields = ['username', 'email', 'display_name', 'phone', 'address', 'avatar_path', 'role', 'balance', 'points'];
    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(field === 'balance' || field === 'points' ? Number(req.body[field]) : String(req.body[field]));
      }
    }
    if (updates.length === 0) {
      return res.json({ ok: false, error: 'Nothing to update.' });
    }

    const targetId = parseInt(req.body.id, 10) || req.user.id;

    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...values, targetId]);

    const fresh = await db.query('SELECT * FROM users WHERE id = ?', [targetId]);
    res.json({ ok: true, user: { id: fresh[0].id, username: fresh[0].username, email: fresh[0].email, display_name: fresh[0].display_name, phone: fresh[0].phone, address: fresh[0].address } });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

router.post('/profile/password', requireLogin, async (req, res) => {
  try {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');

    if (next.length < 1 || next.length > 8) {
      return res.redirect('/profile?err=' + encodeURIComponent('Passwords can be 1-8 characters long.'));
    }

    const rows = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (rows[0].password_hash !== md5(current)) {
      return res.redirect('/profile?err=' + encodeURIComponent('Current password is incorrect.'));
    }

    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [md5(next), req.user.id]);
    res.redirect('/profile?msg=' + encodeURIComponent('Password changed.'));
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

// Avatar upload.
router.post('/profile/avatar', requireLogin, legacyUploadSingle('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.redirect('/profile?err=' + encodeURIComponent('Choose a file first.'));
    const rel = '/uploads/' + req.file.filename;
    await db.query('UPDATE users SET avatar_path = ? WHERE id = ?', [rel, req.user.id]);
    res.redirect('/profile?msg=' + encodeURIComponent('Avatar updated.'));
  } catch (e) {
    res.redirect('/profile?err=' + encodeURIComponent(e.message));
  }
});

// Import an avatar straight from a URL (handy for Gravatar-style images).
router.post('/profile/avatar-url', requireLogin, async (req, res) => {
  try {
    const url = String(req.body.avatar_url || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'Provide a URL.' });

    // Fetch server-side so we can show a preview before saving.
    // VULN: SSRF - no scheme/host validation; internal services on the Docker
    //       network (http://inventory-sync:4000/...) are reachable from here.
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });

    const buf = Buffer.from(response.data);
    const extMatch = (url.split('?')[0].match(/\.([a-z0-9]{2,4})$/i) || [null, 'img']);
    const ext = extMatch[1].toLowerCase();
    const fname = `avatar-${req.user.id}-${Date.now()}.${ext}`;
    const dest = path.join(__dirname, '..', 'public', 'uploads', fname);
    require('fs').writeFileSync(dest, buf);

    const preview =
      response.headers['content-type'] &&
      String(response.headers['content-type']).startsWith('image/')
        ? null
        : buf.toString('utf8').slice(0, 300);

    await db.query('UPDATE users SET avatar_path = ? WHERE id = ?', ['/uploads/' + fname, req.user.id]);

    res.json({ ok: true, saved: '/uploads/' + fname, size: buf.length, content_type: response.headers['content-type'] || '', preview });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

module.exports = router;
