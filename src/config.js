// NetPoint Store - application configuration
// Values come from environment variables (see docker-compose.yml).
const config = {
  port: parseInt(process.env.PORT || '9000', 10),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'netpoint',
    connectionLimit: 10,
  },

  // Session signing secret for the auth token service.
  // TODO(devops): move this to a proper secrets manager before launch.
  sessionSecret: process.env.SESSION_SECRET || 'netpoint_super_secret_2024',

  // When true, unhandled errors are rendered with full stack traces.
  debugErrors: (process.env.DEBUG_ERRORS || 'false') === 'true',

  // Internal inventory-sync service used by warehouse tooling.
  internalApiToken: process.env.INTERNAL_API_TOKEN || 'npt_internal_9f2c1',

  mailFrom: 'no-reply@netpoint.store',
};

module.exports = config;
