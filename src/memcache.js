/**
 * Multi-RBL Lookup Tool
 * Copyright (C) 2025 Matthew Asham & Multi-RBL Lookup Contributors
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

/**
 * Memcache Client Wrapper
 * Provides in-memory caching layer for RBL lookup results
 */

import memjs from 'memjs';

class MemcacheClient {
  constructor() {
    this.enabled = process.env.MEMCACHE_ENABLED === 'true';
    this.client = null;

    if (this.enabled) {
      const servers = process.env.MEMCACHE_SERVERS || 'localhost:11211';

      this.client = memjs.Client.create(servers, {
        retries: 2,
        retry_delay: 0.2,
        expires: 0, // TTL is set per-key
        logger: {
          log: (msg) => {
            if (process.env.MEMCACHE_DEBUG === 'true') {
              console.log(`[Memcache] ${msg}`);
            }
          }
        }
      });

      console.log(`Memcache enabled: ${servers}`);
    } else {
      console.log('Memcache disabled (set MEMCACHE_ENABLED=true to enable)');
    }
  }

  /**
   * Generate cache key for RBL lookup
   */
  generateKey(ip, rblHost) {
    return `rbl:${ip}:${rblHost}`;
  }

  /**
   * Get cached RBL result
   * @param {string} ip - IP address
   * @param {string} rblHost - RBL host
   * @returns {Promise<object|null>} Cached result or null
   */
  async get(ip, rblHost) {
    if (!this.enabled || !this.client) {
      return null;
    }

    try {
      const key = this.generateKey(ip, rblHost);
      const { value } = await this.client.get(key);

      if (!value) {
        return null;
      }

      const result = JSON.parse(value.toString());

      // Check if expired
      const now = Math.floor(Date.now() / 1000);
      if (result.expiresAt && result.expiresAt <= now) {
        // Expired, delete it
        await this.client.delete(key);
        return null;
      }

      return result;
    } catch (error) {
      console.error('Memcache get error:', error.message);
      return null;
    }
  }

  /**
   * Set cached RBL result
   * @param {string} ip - IP address
   * @param {string} rblHost - RBL host
   * @param {object} result - Result object
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async set(ip, rblHost, result, ttl) {
    if (!this.enabled || !this.client) {
      return false;
    }

    try {
      const key = this.generateKey(ip, rblHost);
      const value = JSON.stringify(result);

      // Set with TTL (memjs expects seconds)
      await this.client.set(key, value, { expires: ttl });
      return true;
    } catch (error) {
      console.error('Memcache set error:', error.message);
      return false;
    }
  }

  /**
   * Delete cached result
   * @param {string} ip - IP address
   * @param {string} rblHost - RBL host (optional, if not provided deletes all for IP)
   * @returns {Promise<boolean>} Success status
   */
  async delete(ip, rblHost = null) {
    if (!this.enabled || !this.client) {
      return false;
    }

    try {
      if (rblHost) {
        // Delete specific entry
        const key = this.generateKey(ip, rblHost);
        await this.client.delete(key);
      } else {
        // Delete all entries for IP (pattern delete not supported by memcache)
        // This would require tracking all RBL hosts separately
        // For now, just log a warning
        console.warn('Memcache: Cannot delete by IP pattern, specific rblHost required');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Memcache delete error:', error.message);
      return false;
    }
  }

  /**
   * Flush all cache
   * @returns {Promise<boolean>} Success status
   */
  async flush() {
    if (!this.enabled || !this.client) {
      return false;
    }

    try {
      await this.client.flush();
      console.log('Memcache flushed');
      return true;
    } catch (error) {
      console.error('Memcache flush error:', error.message);
      return false;
    }
  }

  /**
   * Get stats
   * @returns {Promise<object>} Stats object
   */
  async stats() {
    if (!this.enabled || !this.client) {
      return { enabled: false };
    }

    try {
      const stats = await this.client.stats();
      return {
        enabled: true,
        servers: stats
      };
    } catch (error) {
      console.error('Memcache stats error:', error.message);
      return { enabled: true, error: error.message };
    }
  }

  /**
   * Close connection
   */
  close() {
    if (this.client) {
      this.client.close();
    }
  }
}

// Export singleton instance
let instance = null;

export function getMemcache() {
  if (!instance) {
    instance = new MemcacheClient();
  }
  return instance;
}

export { MemcacheClient };
