// Express application wiring.
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');

const { attachUser, cartCount, flash } = require('./middleware/auth');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// CORS so the future mobile app can call our JSON endpoints.
// VULN: Security Misconfiguration - reflects any Origin together with
//       "Access-Control-Allow-Credentials: true".
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Static assets. Dotfiles stay reachable because some tooling expects
// /.well-known/ style paths to work.
// VULN: Security Misconfiguration - dotfiles are served, so /.env and the
//       committed /.git/ tree under public/ are downloadable.
const PUBLIC_DIR = path.join(__dirname, 'public');

// Friendly directory index for customer uploads.
// VULN: Security Misconfiguration - directory listing is enabled on /uploads/.
app.use('/uploads', (req, res, next) => {
  const clean = path.normalize(decodeURIComponent(req.path)).replace(/^([/\\])+/, '');
  if (clean.includes('..')) return next();
  const dir = path.join(PUBLIC_DIR, 'uploads', clean);
  if (!fs.existsSync(dir)) return next();
  if (fs.statSync(dir).isDirectory()) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter((e) => !e.startsWith('.'));
    } catch (e) { /* ignore */ }
    const rows = entries.map((e) => {
      const st = fs.statSync(path.join(dir, e));
      return `<li><a href="/uploads/${clean ? clean + '/' : ''}${encodeURIComponent(e)}">${e}</a> <small>(${st.size} bytes)</small></li>`;
    }).join('\n');
    return res.type('html').send(
      `<h1>Index of /uploads/${clean}</h1><hr><ul>${rows || '<li><em>(empty)</em></li>'}</ul><hr><address>NetPoint Store</address>`
    );
  }
  next();
}, express.static(path.join(PUBLIC_DIR, 'uploads')));

app.use(express.static(PUBLIC_DIR, { dotfiles: 'allow' }));

app.use(attachUser);
app.use(cartCount);
app.use(flash);

app.use(require('./routes/products'));
app.use(require('./routes/auth'));
app.use(require('./routes/cart'));
app.use(require('./routes/orders'));
app.use(require('./routes/profile'));
app.use(require('./routes/admin'));
app.use(require('./routes/misc'));

app.use((req, res) => {
  res.status(404).render('404', { title: 'Page not found' });
});

// Central error reporter.
// VULN: Security Misconfiguration - full stack traces are returned to clients
//       when DEBUG_ERRORS=true (default in docker-compose).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (config.debugErrors) {
    res.status(err.status || 500).send(`<h1>Something went wrong</h1><pre>${err.stack}</pre><p><a href="/">Back to NetPoint Store</a></p>`);
  } else {
    res.status(err.status || 500).render('error', { title: 'Error', error: { message: 'Unexpected server error.' }, debugErrors: false });
  }
});

module.exports = app;
