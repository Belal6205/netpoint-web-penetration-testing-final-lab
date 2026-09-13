const jwt = require('../util/jwtx');
const db = require('../db');

// Resolves the session cookie into req.user on every request.
async function attachUser(req, res, next) {
  req.user = null;
  const token = req.cookies ? req.cookies.session : null;

  if (token) {
    const payload = jwt.verify(token);
    if (payload && payload.uid) {
      try {
        const rows = await db.query('SELECT id, username, email, role, display_name, phone, address, avatar_path, balance, points FROM users WHERE id = ?', [payload.uid]);
        if (rows.length > 0) req.user = rows[0];
      } catch (e) {
        req.user = null;
      }
    }
  }

  res.locals.user = req.user;
  next();
}

// Shows a cart badge count in the navbar.
async function cartCount(req, res, next) {
  res.locals.cartCount = 0;
  if (req.user) {
    try {
      const rows = await db.query('SELECT COALESCE(SUM(qty),0) AS n FROM cart_items WHERE user_id = ?', [req.user.id]);
      res.locals.cartCount = Number(rows[0].n) || 0;
    } catch (e) { /* navbar badge is non-critical */ }
  }
  next();
}

// Flash messages travel through query params (?msg=..&err=..).
function flash(req, res, next) {
  res.locals.flashMsg = req.query.msg || null;
  res.locals.flashErr = req.query.err || null;
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  // VULN: Broken Access Control - only checks that the visitor is logged in,
  // never verifies user.role === 'admin'. Any registered account can reach
  // every /admin route by browsing directly.
  next();
}

module.exports = { attachUser, cartCount, flash, requireLogin, requireAdmin };
