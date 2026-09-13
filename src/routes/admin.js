// Back office: catalog management, orders, customers, catalog import.
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const router = express.Router();
const db = require('../db');
const xmlparse = require('../util/xmlparse');
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');
const { xmlUploader } = require('../middleware/upload');

// Every /admin route sits behind the admin gate.
// VULN: Broken Access Control - the gate only checks "is logged in", never
//       checks user.role === 'admin'.
router.use('/admin', requireAdmin);

router.get('/admin', async (req, res) => {
  try {
    const counts = await db.query(
      `SELECT (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM products) AS products,
              (SELECT COUNT(*) FROM orders) AS orders,
              (SELECT COALESCE(SUM(total),0) FROM orders WHERE status <> 'cancelled') AS revenue`
    );
    const recentOrders = await db.query(
      `SELECT o.*, u.username FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 8`
    );
    res.render('admin/dash', { title: 'Admin', counts: counts[0], recentOrders });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

// --- Catalog ---------------------------------------------------------------

router.get('/admin/products', async (req, res) => {
  try {
    const products = await db.query(
      `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id`
    );
    const categories = await db.query('SELECT * FROM categories ORDER BY name');
    res.render('admin/products', { title: 'Products - Admin', products, categories });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.post('/admin/products/save', async (req, res) => {
  try {
    const id = parseInt(req.body.id, 10) || 0;
    const fields = {
      name: String(req.body.name || '').trim(),
      description: String(req.body.description || '').trim(),
      price: parseFloat(req.body.price) || 0,
      stock: parseInt(req.body.stock, 10) || 0,
      image_url: String(req.body.image_url || '/img/products/placeholder.svg').trim(),
      category_id: parseInt(req.body.category_id, 10) || null,
      featured: req.body.featured === 'on' ? 1 : 0,
    };
    if (!fields.name) throw new Error('Name is required.');

    if (id > 0) {
      await db.query(
        `UPDATE products SET name=?, description=?, price=?, stock=?, image_url=?, category_id=?, featured=? WHERE id=?`,
        [fields.name, fields.description, fields.price, fields.stock, fields.image_url, fields.category_id, fields.featured, id]
      );
    } else {
      await db.query(
        `INSERT INTO products (name, description, price, stock, image_url, category_id, featured) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [fields.name, fields.description, fields.price, fields.stock, fields.image_url, fields.category_id, fields.featured]
      );
    }
    res.redirect('/admin/products?msg=' + encodeURIComponent('Catalog updated.'));
  } catch (e) {
    res.redirect('/admin/products?err=' + encodeURIComponent(e.message));
  }
});

router.post('/admin/products/delete', async (req, res) => {
  try {
    await db.query('DELETE FROM products WHERE id = ?', [parseInt(req.body.id, 10)]);
    res.redirect('/admin/products?msg=' + encodeURIComponent('Product removed.'));
  } catch (e) {
    res.redirect('/admin/products?err=' + encodeURIComponent(e.message));
  }
});

// Pull a product photo from a supplier URL.
router.post('/admin/products/sync-image', async (req, res) => {
  try {
    const url = String(req.body.image_url_source || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'Provide a source URL.' });

    // Server-side fetch so the CDN never sees our credentials.
    // VULN: SSRF - no validation; internal services are reachable here too.
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
    const buf = Buffer.from(response.data);
    const fname = `synced-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(__dirname, '..', 'public', 'uploads', fname), buf);

    const preview = buf.toString('utf8', 0, 300);

    res.json({ ok: true, saved: '/uploads/' + fname, size: buf.length, content_type: response.headers['content-type'] || '', preview });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

// --- Orders ------------------------------------------------------------------

router.get('/admin/orders', async (req, res) => {
  try {
    const orders = await db.query(
      `SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 200`
    );
    res.render('admin/orders', { title: 'Orders - Admin', orders });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.post('/admin/orders/status', async (req, res) => {
  try {
    await db.query('UPDATE orders SET status = ? WHERE id = ?', [String(req.body.status), parseInt(req.body.id, 10)]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

// --- Customers ----------------------------------------------------------------

router.get('/admin/users', async (req, res) => {
  try {
    const users = await db.query('SELECT id, username, email, role, balance, points, created_at FROM users ORDER BY id');
    res.render('admin/users', { title: 'Customers - Admin', users });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.post('/admin/users/role', async (req, res) => {
  try {
    await db.query('UPDATE users SET role = ? WHERE id = ?', [String(req.body.role), parseInt(req.body.id, 10)]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

router.post('/admin/users/delete', async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = ?', [parseInt(req.body.id, 10)]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message) });
  }
});

// --- Catalog import (warehouse XML format) -------------------------------------

router.get('/admin/import', (req, res) => {
  res.render('admin/import', { title: 'Catalog import - Admin' });
});

router.post('/admin/import', xmlUploader, async (req, res) => {
  try {
    let xml = '';
    if (req.file && req.file.buffer !== undefined) {
      xml = req.file.buffer.toString('utf8');
    } else if (req.file && req.file.path) {
      xml = fs.readFileSync(req.file.path, 'utf8');
    } else if (req.body.xmltext) {
      xml = String(req.body.xmltext);
    }
    if (!xml.trim()) throw new Error('Paste XML or choose a file.');

    const doc = xmlparse.parse(xml);

    // Accept both <catalog><product>...</product></catalog> and flat lists.
    let list = [];
    if (doc.catalog && doc.catalog.product !== undefined) {
      list = Array.isArray(doc.catalog.product) ? doc.catalog.product : [doc.catalog.product];
    } else if (doc.product !== undefined) {
      list = Array.isArray(doc.product) ? doc.product : [doc.product];
    } else if (doc.products !== undefined && typeof doc.products === 'object') {
      list = Array.isArray(doc.products.product) ? doc.products.product : [doc.products];
    }

    let imported = 0;
    for (const item of list) {
      const name = String(item.name || '').trim();
      if (!name) continue;
      const price = parseFloat(String(item.price)) || 0;
      const stock = parseInt(String(item.stock), 10) || 0;
      const catName = String(item.category || 'Misc').trim();

      let catRows = await db.query('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)', [catName]);
      if (catRows.length === 0) {
        const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        await db.query('INSERT INTO categories (name, slug) VALUES (?, ?)', [catName, slug]);
        catRows = await db.query('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)', [catName]);
      }

      await db.query(
        'INSERT INTO products (name, description, price, stock, image_url, category_id) VALUES (?, ?, ?, ?, ?, ?)',
        [name.slice(0, 120), String(item.description || ''), price, stock, '/img/products/placeholder.svg', catRows[0].id]
      );
      imported++;
    }

    res.render('admin/import', {
      title: 'Catalog import - Admin',
      msg: `Import finished: ${imported} product(s) added.`,
      importedNames: list.map((i) => String(i.name || '')).filter(Boolean),
    });
  } catch (e) {
    res.render('admin/import', {
      title: 'Catalog import - Admin',
      err: e.message,
    });
  }
});

module.exports = router;
