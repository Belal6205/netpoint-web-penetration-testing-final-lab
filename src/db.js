// Database access layer.
// Newer code uses db.query() with placeholders; a couple of legacy code
// paths still go through db.raw(), which does plain string interpolation.
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  namedPlaceholders: false,
});

// Parameterized query - use this everywhere in new code.
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// Legacy helper. Old modules build SQL with string concatenation here.
// VULN: SQL Injection - raw() interpolates values directly into the SQL string.
async function raw(sql) {
  const [rows] = await pool.query(sql);
  return rows;
}

async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, raw, ping };
