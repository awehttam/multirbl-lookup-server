/**
 * PostgreSQL Database Connection Pool
 * Provides connection pooling and query interface for PostgreSQL
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Singleton pool instance
let pool = null;

/**
 * Initialize PostgreSQL connection pool
 * @returns {Pool} PostgreSQL connection pool
 */
export function getPool() {
  if (!pool) {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'multirbl',
      user: process.env.DB_USER || 'multirbl',
      password: process.env.DB_PASSWORD || '',
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '2000'),
    };

    pool = new Pool(config);

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });

    // Log connection info
    console.log(`PostgreSQL pool initialized: ${config.host}:${config.port}/${config.database}`);
  }

  return pool;
}

/**
 * Execute a query with parameters
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
export async function query(text, params) {
  const pool = getPool();
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries (> 100ms)
    if (duration > 100) {
      console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
    }

    return result;
  } catch (error) {
    console.error('Database query error:', error.message);
    console.error('Query:', text);
    console.error('Params:', params);
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<PoolClient>} Database client
 */
export async function getClient() {
  const pool = getPool();
  return await pool.connect();
}

/**
 * Close the connection pool
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('PostgreSQL pool closed');
  }
}

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testConnection() {
  try {
    const result = await query('SELECT NOW() as now, version() as version');
    console.log('✓ PostgreSQL connection successful');
    console.log(`  Server time: ${result.rows[0].now}`);
    console.log(`  Version: ${result.rows[0].version.split('\n')[0]}`);
    return true;
  } catch (error) {
    console.error('✗ PostgreSQL connection failed:', error.message);
    return false;
  }
}

// Export pool for direct access if needed
export default {
  getPool,
  query,
  getClient,
  closePool,
  testConnection,
};
