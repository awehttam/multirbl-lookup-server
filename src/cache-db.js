/**
 * Multi-RBL Lookup Tool
 * Copyright (C) 2025 Matthew Asham
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { query } from './db-postgres.js';

/**
 * Database manager for caching DNS RBL lookup results
 * Now uses PostgreSQL instead of SQLite
 */
class CacheDatabase {
  constructor(dbPath = null) {
    // dbPath parameter kept for backwards compatibility but ignored
    // PostgreSQL connection is configured via environment variables
    this.initSchema();
  }

  /**
   * Initialize database schema
   * Schema is created via migration script, this just verifies
   */
  async initSchema() {
    // Schema initialization is handled by database/migrate.js
    // This method kept for backwards compatibility
  }

  /**
   * Get cached result for IP and RBL host
   * @param {string} ip - IP address
   * @param {string} rblHost - RBL host
   * @returns {Promise<object|null>} Cached result or null if not found/expired
   */
  async getCached(ip, rblHost) {
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = await query(
        `SELECT host(ip) as ip, rbl_host, listed, host(response) as response, error, ttl, cached_at, expires_at
         FROM rbl_cache
         WHERE ip = $1::inet AND rbl_host = $2 AND expires_at > $3`,
        [ip, rblHost, now]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        ip: row.ip,
        rblHost: row.rbl_host,
        listed: row.listed,
        response: row.response,
        error: row.error,
        ttl: row.ttl,
        cachedAt: row.cached_at,
        expiresAt: row.expires_at,
        fromCache: true
      };
    } catch (error) {
      console.error('Error getting cached result:', error.message);
      return null;
    }
  }

  /**
   * Cache a DNS lookup result
   * @param {string} ip - IP address
   * @param {string} rblHost - RBL host
   * @param {boolean} listed - Whether IP is listed
   * @param {string|null} response - DNS response (IP address if listed)
   * @param {string|null} error - Error message if lookup failed
   * @param {number} ttl - Time to live in seconds (default 3600)
   * @returns {Promise<void>}
   */
  async cache(ip, rblHost, listed, response = null, error = null, ttl = 3600) {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttl;

    try {
      await query(
        `INSERT INTO rbl_cache (ip, rbl_host, listed, response, error, ttl, cached_at, expires_at)
         VALUES ($1::inet, $2, $3, $4::inet, $5, $6, $7, $8)
         ON CONFLICT(ip, rbl_host) DO UPDATE SET
           listed = EXCLUDED.listed,
           response = EXCLUDED.response,
           error = EXCLUDED.error,
           ttl = EXCLUDED.ttl,
           cached_at = EXCLUDED.cached_at,
           expires_at = EXCLUDED.expires_at`,
        [ip, rblHost, listed, response, error, ttl, now, expiresAt]
      );
    } catch (error) {
      console.error('Error caching result:', error.message);
    }
  }

  /**
   * Clean up expired cache entries
   * @returns {Promise<number>} Number of deleted entries
   */
  async cleanExpired() {
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = await query('DELETE FROM rbl_cache WHERE expires_at <= $1', [now]);
      return result.rowCount;
    } catch (error) {
      console.error('Error cleaning expired cache:', error.message);
      return 0;
    }
  }

  /**
   * Get cache statistics
   * @returns {Promise<object>} Cache stats
   */
  async getStats() {
    const now = Math.floor(Date.now() / 1000);

    try {
      const results = await query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE expires_at > $1) as valid,
          COUNT(*) FILTER (WHERE expires_at <= $1) as expired,
          COUNT(*) FILTER (WHERE expires_at > $1 AND listed = true) as listed,
          COUNT(*) FILTER (WHERE expires_at > $1 AND listed = false) as not_listed,
          COUNT(*) FILTER (WHERE expires_at > $1 AND error IS NOT NULL) as errors
         FROM rbl_cache`,
        [now]
      );

      const row = results.rows[0];
      return {
        total: parseInt(row.total),
        valid: parseInt(row.valid),
        expired: parseInt(row.expired),
        listed: parseInt(row.listed),
        notListed: parseInt(row.not_listed),
        errors: parseInt(row.errors)
      };
    } catch (error) {
      console.error('Error getting cache stats:', error.message);
      return { total: 0, valid: 0, expired: 0, listed: 0, notListed: 0, errors: 0 };
    }
  }

  /**
   * Clear all cache entries
   * @returns {Promise<number>} Number of deleted entries
   */
  async clearAll() {
    try {
      const result = await query('DELETE FROM rbl_cache');
      return result.rowCount;
    } catch (error) {
      console.error('Error clearing cache:', error.message);
      return 0;
    }
  }

  /**
   * Clear cache for specific IP
   * @param {string} ip - IP address
   * @returns {Promise<number>} Number of deleted entries
   */
  async clearIp(ip) {
    try {
      const result = await query('DELETE FROM rbl_cache WHERE ip = $1::inet', [ip]);
      return result.rowCount;
    } catch (error) {
      console.error('Error clearing IP cache:', error.message);
      return 0;
    }
  }

  /**
   * Close database connection
   */
  close() {
    // Connection pooling handled by db-postgres.js
    // This method kept for backwards compatibility
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
