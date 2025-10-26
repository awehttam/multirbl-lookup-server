import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database manager for caching DNS RBL lookup results
 */
class CacheDatabase {
  constructor(dbPath = null) {
    if (!dbPath) {
      const dataDir = join(__dirname, '..', 'data');
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      dbPath = join(dataDir, 'rbl-cache.db');
    }

    this.db = new Database(dbPath);
    this.initSchema();
  }

  /**
   * Initialize database schema
   */
  initSchema() {
    // Create cache table for RBL lookups
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rbl_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        rbl_host TEXT NOT NULL,
        listed INTEGER NOT NULL,
        response TEXT,
        error TEXT,
        ttl INTEGER NOT NULL,
        cached_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        UNIQUE(ip, rbl_host)
      );

      CREATE INDEX IF NOT EXISTS idx_ip_rbl ON rbl_cache(ip, rbl_host);
      CREATE INDEX IF NOT EXISTS idx_expires ON rbl_cache(expires_at);
    `);
  }

  /**
   * Get cached result for IP and RBL host
   * @param {string} ip - IP address
   * @param {string} rblHost - RBL host
   * @returns {object|null} Cached result or null if not found/expired
   */
  getCached(ip, rblHost) {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      SELECT ip, rbl_host, listed, response, error, ttl, cached_at, expires_at
      FROM rbl_cache
      WHERE ip = ? AND rbl_host = ? AND expires_at > ?
    `);

    const row = stmt.get(ip, rblHost, now);

    if (!row) {
      return null;
    }

    return {
      ip: row.ip,
      rblHost: row.rbl_host,
      listed: row.listed === 1,
      response: row.response,
      error: row.error,
      ttl: row.ttl,
      cachedAt: row.cached_at,
      expiresAt: row.expires_at,
      fromCache: true
    };
  }

  /**
   * Cache a DNS lookup result
   * @param {string} ip - IP address
   * @param {string} rblHost - RBL host
   * @param {boolean} listed - Whether IP is listed
   * @param {string|null} response - DNS response (IP address if listed)
   * @param {string|null} error - Error message if lookup failed
   * @param {number} ttl - Time to live in seconds (default 3600)
   */
  cache(ip, rblHost, listed, response = null, error = null, ttl = 3600) {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttl;

    const stmt = this.db.prepare(`
      INSERT INTO rbl_cache (ip, rbl_host, listed, response, error, ttl, cached_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ip, rbl_host) DO UPDATE SET
        listed = excluded.listed,
        response = excluded.response,
        error = excluded.error,
        ttl = excluded.ttl,
        cached_at = excluded.cached_at,
        expires_at = excluded.expires_at
    `);

    stmt.run(ip, rblHost, listed ? 1 : 0, response, error, ttl, now, expiresAt);
  }

  /**
   * Clean up expired cache entries
   * @returns {number} Number of deleted entries
   */
  cleanExpired() {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare('DELETE FROM rbl_cache WHERE expires_at <= ?');
    const result = stmt.run(now);
    return result.changes;
  }

  /**
   * Get cache statistics
   * @returns {object} Cache stats
   */
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM rbl_cache').get();
    const now = Math.floor(Date.now() / 1000);
    const valid = this.db.prepare('SELECT COUNT(*) as count FROM rbl_cache WHERE expires_at > ?').get(now);
    const expired = total.count - valid.count;

    const listed = this.db.prepare(
      'SELECT COUNT(*) as count FROM rbl_cache WHERE expires_at > ? AND listed = 1'
    ).get(now);

    const notListed = this.db.prepare(
      'SELECT COUNT(*) as count FROM rbl_cache WHERE expires_at > ? AND listed = 0'
    ).get(now);

    const errors = this.db.prepare(
      'SELECT COUNT(*) as count FROM rbl_cache WHERE expires_at > ? AND error IS NOT NULL'
    ).get(now);

    return {
      total: total.count,
      valid: valid.count,
      expired: expired,
      listed: listed.count,
      notListed: notListed.count,
      errors: errors.count
    };
  }

  /**
   * Clear all cache entries
   * @returns {number} Number of deleted entries
   */
  clearAll() {
    const stmt = this.db.prepare('DELETE FROM rbl_cache');
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Clear cache for specific IP
   * @param {string} ip - IP address
   * @returns {number} Number of deleted entries
   */
  clearIp(ip) {
    const stmt = this.db.prepare('DELETE FROM rbl_cache WHERE ip = ?');
    const result = stmt.run(ip);
    return result.changes;
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

// Export singleton instance
let instance = null;

export function getDatabase(dbPath = null) {
  if (!instance) {
    instance = new CacheDatabase(dbPath);
  }
  return instance;
}

export { CacheDatabase };
