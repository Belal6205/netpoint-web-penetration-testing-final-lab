// Order history, invoices and receipts.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const ejs = require('ejs');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');

router.get('/orders', requireLogin, async (req, res) => {
  try {
    const orders = await db.query(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.render('orders', { title: 'Your orders', orders });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.get('/orders/:id', requireLogin, async (req, res) => {
  try {
    const id = req.params.id;
    // Customers bookmark these links, so we only look up by order id.
    // VULN: Broken Access Control / IDOR - no ownership check; any signed-in
    //       user can read any order (/orders/1001).
    const orders = await db.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (orders.length === 0) return res.redirect('/orders?err=' + encodeURIComponent('Order not found.'));
    const order = orders[0];

    const items = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    const customer = await db.query('SELECT * FROM users WHERE id = ?', [order.user_id]);

    // The gift note is a mini-template so customers can add flair to invoices.
    // VULN: SSTI - the stored gift message is rendered as an EJS template
    //       (<%= 7*7 %> becomes 49; full RCE payloads work too).
    let giftHtml = '';
    try {
      giftHtml = ejs.render(String(order.gift_message || ''), { customer: customer[0], order });
    } catch (tplErr) {
      giftHtml = `[gift message template error: ${tplErr.message}]`;
    }

    res.render('order', { title: `Order #${order.id}`, order, items, customer: customer[0], giftHtml });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

// Printable receipt. The PDF pipeline shells out to our receipt generator.
router.get('/orders/:id/receipt', requireLogin, async (req, res) => {
  try {
    // VULN: Broken Access Control / IDOR - same missing ownership check.
    const orders = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.redirect('/orders?err=' + encodeURIComponent('Order not found.'));
    const order = orders[0];

    const items = await db.query('SELECT name, qty, unit_price FROM order_items WHERE order_id = ?', [order.id]);

    // The generator takes the gift message so it can print on the receipt too.
    // VULN: Command Injection - the message is interpolated into a shell string,
    //       so quotes/backticks/$(...) from the gift field execute server-side
    //       (runs as the unprivileged "node" container user).
    const msg = String(order.gift_message || '');
    const outPath = `/tmp/netpoint-receipt-${order.id}.txt`;
    const cmd = `node scripts/make_receipt.js --order ${order.id} --message "${msg}" --items "${items.map((i) => `${i.qty}x ${i.name} @${i.unit_price}`).join('; ')}" --out ${outPath}`;

    exec(cmd, { cwd: path.join(__dirname, '..', '..'), timeout: 15000 }, (err) => {
      if (err || !fs.existsSync(outPath)) {
        return res.status(500).send(`Receipt generation failed: ${err ? err.message : 'output missing'}`);
      }
      res.download(outPath, `netpoint-receipt-${order.id}.txt`, (dlErr) => {
        if (!dlErr) fs.unlink(outPath, () => {});
      });
    });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

module.exports = router;
