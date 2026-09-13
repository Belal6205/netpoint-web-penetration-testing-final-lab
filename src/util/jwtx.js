// Lightweight JWT implementation used for the "session" cookie.
//
// This is an in-house replacement we wrote when we dropped Passport.
// It signs tokens with HMAC-SHA256 but the verifier is lenient about
// algorithms so that unsigned internal tokens keep working.
const crypto = require('crypto');
const config = require('../config');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(data) {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function hmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function sign(payload, secret = config.sessionSecret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = hmac(header + '.' + body, secret);
  return `${header}.${body}.${sig}`;
}

function verify(token, secret = config.sessionSecret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch (e) {
    return null;
  }

  // Unsigned tokens ("none" algorithm) are still accepted for backwards
  // compatibility with the warehouse handheld scanners.
  // VULN: JWT alg=none accepted - anyone can forge a token without knowing the secret.
  if (header.alg === 'none') {
    return payload;
  }

  if (parts.length < 3) return null;
  const expected = hmac(parts[0] + '.' + parts[1], secret);
  // VULN: JWT weak/hardcoded secret + non-timing-safe comparison (brute-forceable offline).
  if (parts[2] !== expected) return null;

  // VULN: JWT no expiry check - "exp"/"iat" claims are never enforced.
  return payload;
}

module.exports = { sign, verify };
