// Product catalog, search and reviews.
const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');
const { legacyUploadSingle } = require('../middleware/upload');

router.get('/products', async (req, res) => {
  try {
    const q = String(req.query.search || '').trim();
    const category = String(req.query.category || '');

    let sql = `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE 1=1`;
    if (q !== '') {
      // Full-text-ish search across name and description.
      // VULN: SQL Injection - user input is concatenated straight into LIKE clauses.
      sql += ` AND (p.name LIKE '%${q}%' OR p.description LIKE '%${q}%')`;
    }
    if (category !== '') {
      sql += ` AND p.category_id = ${category}`;
    }
    sql += ` ORDER BY p.featured DESC, p.id ASC`;

    const products = await db.raw(sql);
    const categories = await db.query('SELECT * FROM categories ORDER BY name');

    res.render('products', { title: 'Catalog', products, categories, q, cat: category });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.get('/', async (req, res) => {
  try {
    const featured = await db.query('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.featured = 1 LIMIT 4');
    res.render('home', { title: 'Home', featured });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.get('/product/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    // VULN: SQL Injection - numeric-looking parameter is still concatenated.
    const rows = await db.raw(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ${id}`);
    if (rows.length === 0) return res.redirect('/products');

    const product = rows[0];
    const reviews = await db.query(
      `SELECT r.*, u.username, u.display_name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.created_at DESC`,
      [product.id]
    );

    res.render('product', { title: product.name, product, reviews });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

router.post('/product/:id/review', requireLogin, legacyUploadSingle('image'), async (req, res) => {
  try {
    const productId = String(req.params.id);
    const rating = parseInt(String(req.body.rating || '5'), 10) || 5;
    const body = String(req.body.body || '').trim();

    if (!body && !req.file) {
      return res.redirect(`/product/${productId}?err=` + encodeURIComponent('Write something first.'));
    }

    const imagePath = req.file ? '/uploads/' + req.file.filename : null;

    await db.query(
      'INSERT INTO reviews (product_id, user_id, rating, body, image_path) VALUES (?, ?, ?, ?, ?)',
      [productId, req.user.id, Math.min(5, Math.max(1, rating)), body, imagePath]
    );

    res.redirect(`/product/${productId}?msg=` + encodeURIComponent('Thanks for your review!'));
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

// Community leaderboard - most active reviewers.
router.get('/leaderboard', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT u.username, u.display_name, COUNT(r.id) AS review_count, ROUND(AVG(r.rating),1) AS avg_rating
       FROM users u JOIN reviews r ON r.user_id = u.id
       GROUP BY u.id ORDER BY review_count DESC, avg_rating DESC LIMIT 20`
    );
    res.render('leaderboard', { title: 'Top reviewers', leaders: rows });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', error: e, debugErrors: config.debugErrors });
  }
});

module.exports = router;
