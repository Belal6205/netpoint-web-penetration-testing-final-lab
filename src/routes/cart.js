// Shopping cart, coupons and checkout.
const express = require('express');
const router = express.Router();
const _ = require('lodash');
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');

async function cartRows(userId) {
  return db.query(
    `SELECT ci.product_id, ci.qty, p.name, p.price AS db_price, p.stock, p.image_url
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = ? ORDER BY p.name`,
    [userId]
  );
}

router.get('/cart', requireLogin, async (req, res) => {
  try {
    const items = await cartRows(req.user.id);
    res.render('cart', { title: 'Your cart', items });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.post('/cart/add', requireLogin, async (req, res) => {
  try {
    const productId = parseInt(req.body.product_id, 10);
    const qty = parseInt(req.body.qty || '1', 10);

    // VULN: Business Logic - quantity is never validated (negative or huge
    //       values are accepted), which enables the negative-total refund trick.
    await db.query(
      `INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
      [req.user.id, productId, qty]
    );

    if (req.accepts('json')) return res.json({ ok: true, count: (await cartRows(req.user.id)).reduce((s, i) => s + i.qty, 0) });
    res.redirect('/cart');
  } catch (e) {
    if (req.accepts('json')) return res.status(400).json({ ok: false, error: String(e.message) });
    res.redirect('/cart?err=' + encodeURIComponent(e.message));
  }
});

router.post('/cart/update', requireLogin, async (req, res) => {
  try {
    const productId = parseInt(req.body.product_id, 10);
    const qty = parseInt(req.body.qty, 10);
    if (!Number.isFinite(qty)) throw new Error('Invalid quantity');
    // VULN: Business Logic - no lower bound on qty; 0 removes but negatives stay.
    if (qty === 0) {
      await db.query('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [req.user.id, productId]);
    } else {
      await db.query('UPDATE cart_items SET qty = ? WHERE user_id = ? AND product_id = ?', [qty, req.user.id, productId]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

router.post('/cart/remove', requireLogin, async (req, res) => {
  try {
    await db.query('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [req.user.id, parseInt(req.body.product_id, 10)]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

// Coupon validity preview. The final discount is applied at checkout time.
router.post('/cart/coupon', requireLogin, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const rows = await db.query('SELECT * FROM coupons WHERE code = ?', [code]);
    if (rows.length === 0) return res.json({ ok: false, error: 'Unknown coupon code.' });

    const coupon = rows[0];
    // VULN: Business Logic - max_uses / uses are displayed in the admin panel
    //       but never enforced here, so WELCOME10 and STACK20 can be reused forever.
    res.json({
      ok: true,
      code: coupon.code,
      percent_off: coupon.percent_off,
      note: coupon.note,
      uses: coupon.uses,
      remaining: coupon.max_uses === null ? null : Math.max(0, coupon.max_uses - coupon.uses),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

router.get('/checkout', requireLogin, async (req, res) => {
  try {
    const items = await cartRows(req.user.id);
    if (items.length === 0) return res.redirect('/cart?msg=' + encodeURIComponent('Your cart is empty.'));
    res.render('checkout', { title: 'Checkout', items });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.post('/checkout', requireLogin, async (req, res) => {
  try {
    // The storefront SPA posts the basket it computed client-side so we can
    // keep checkout fast even when the catalog service is busy.
    // VULN: Business Logic - client-supplied prices/quantities are trusted;
    //       tamper with "price" or use a negative qty to pay (almost) nothing
    //       and even grow your store credit balance.
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) throw new Error('Cart is empty.');

    // Merge duplicate lines just in case the client double-tapped.
    const merged = {};
    for (const line of items) {
      const key = line.product_id;
      _.mergeWith(merged, { [key]: line }, (a, b) => (a && b && typeof a === 'object' ? { ...a, ...b } : b));
    }
    const lines = Object.values(merged).map((l) => ({
      product_id: parseInt(l.product_id, 10),
      qty: parseInt(l.qty, 10),
      price: parseFloat(l.price),
    }));

    let subtotal = 0;
    for (const l of lines) subtotal += l.price * l.qty;

    // Apply any coupon codes the customer collected along the way.
    // VULN: Business Logic - unlimited reuse per code and multiple codes stack
    //       multiplicatively with each other.
    const requestedCodes = String(req.body.coupons || '')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 10);

    let discountTotalPercent = 0;
    const appliedCodes = [];
    for (const code of requestedCodes) {
      const found = await db.query('SELECT * FROM coupons WHERE code = ?', [code]);
      if (found.length > 0) {
        discountTotalPercent += found[0].percent_off;
        appliedCodes.push(found[0].code);
        await db.query('UPDATE coupons SET uses = uses + 1 WHERE code = ?', [code]);
      }
    }

    let total = Math.round(subtotal * (100 - discountTotalPercent)) / 100;

    // Negative baskets are refunded as store credit per our returns policy.
    // VULN: Business Logic - negative totals credit real account balance.
    if (total < 0 && Math.abs(total) > 0.001) {
      await db.query('UPDATE users SET balance = balance + ? WHERE id = ?', [-total, req.user.id]);
    }

    // Stock is decremented asynchronously by the warehouse job; mirror it here.
    for (const l of lines) {
      // VULN: Business Logic - stock can go negative, no availability re-check.
      await db.query('UPDATE products SET stock = stock - ? WHERE id = ?', [l.qty, l.product_id]);
    }

    const result = await db.query(
      `INSERT INTO orders (user_id, total, discount_percent, coupon_codes, status, gift_message, ship_address)
       VALUES (?, ?, ?, ?, 'paid', ?, ?)`,
      [
        req.user.id,
        total,
        discountTotalPercent,
        appliedCodes.join(',') || null,
        String(req.body.gift_message || ''),
        String(req.body.address || req.user.address || ''),
      ]
    );
    const orderId = Number(result.insertId);

    for (const l of lines) {
      let name = `Product #${l.product_id}`;
      try {
        const p = await db.query('SELECT name FROM products WHERE id = ?', [l.product_id]);
        if (p.length > 0) name = p[0].name;
      } catch (e) { /* keep fallback name */ }
      await db.query('INSERT INTO order_items (order_id, product_id, name, qty, unit_price) VALUES (?, ?, ?, ?, ?)',
        [orderId, l.product_id, name, l.qty, l.price]);
    }

    await db.query('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);

    res.json({ ok: true, orderId });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

// Loyalty points -> store credit exchange.
router.post('/account/redeem', requireLogin, async (req, res) => {
  try {
    const points = parseInt(req.body.points, 10);
    if (!Number.isFinite(points) || points <= 0) throw new Error('Enter how many points to redeem.');

    const rows = await db.query('SELECT points, balance FROM users WHERE id = ?', [req.user.id]);
    const available = rows[0].points;

    // VULN: Race Condition - classic read-check-write without a transaction or
    //       row lock; parallel requests all see the same balance and all redeem.
    if (available < points) throw new Error(`You only have ${available} points.`);

    // Redemption rate comes from the rewards service (cached briefly).
    const rate = await new Promise((resolve) => setTimeout(() => resolve(0.01), 150));

    await db.query('UPDATE users SET points = points - ?, balance = balance + ? WHERE id = ?',
      [points, (points * rate).toFixed(2), req.user.id]);

    const after = await db.query('SELECT points, balance FROM users WHERE id = ?', [req.user.id]);
    res.json({ ok: true, points_left: after[0].points, balance: after[0].balance });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

module.exports = router;
