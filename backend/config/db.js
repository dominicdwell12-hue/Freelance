const mysql = require('mysql2/promise');

// TiDB Serverless requires TLS on its public endpoint. TiDB Cloud gives you
// TIDB_HOST/PORT/USER/PASSWORD/DATABASE directly from its connection dialog —
// no CA file needed, since Node trusts the built-in Mozilla CA bundle.
const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: process.env.TIDB_PORT || 4000,
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE || 'freelance_marketplace',
  ssl: process.env.TIDB_ENABLE_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
});

module.exports = pool;
