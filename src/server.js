// NetPoint Store - entrypoint.
const config = require('./config');
const db = require('./db');

async function waitForDb(retries = 60, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await db.ping();
      console.log(`[boot] database connection established`);
      return true;
    } catch (e) {
      console.log(`[boot] waiting for database (${i}/${retries})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Database unreachable after retries');
}

(async () => {
  try {
    await waitForDb();
  } catch (e) {
    console.error('[boot]', e.message);
    process.exit(1);
  }

  const logsDir = require('path').join(__dirname, '..', 'logs');
  if (!require('fs').existsSync(logsDir)) require('fs').mkdirSync(logsDir);

  const app = require('./app');
  app.listen(config.port, () => {
    console.log('');
    console.log('  NetPoint Store is running');
    console.log(`  http://localhost:${config.port}`);
    console.log('');
  });
})();
