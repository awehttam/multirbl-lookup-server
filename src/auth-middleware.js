/**
 * API Key Authentication Middleware
 * Validates API keys for admin endpoints
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from './db-postgres.js';

const SALT_ROUNDS = 10;

/**
 * Generate a new API key
 * @param {string} description - Description of the API key
 * @returns {Promise<object>} Generated API key info
 */
export async function generateApiKey(description = null) {
  try {
    // Generate a secure random API key (32 bytes = 64 hex chars)
    const apiKey = crypto.randomBytes(32).toString('hex');

    // Create a prefix for identification (first 8 chars)
    const keyPrefix = apiKey.substring(0, 8);

    // Hash the full key for storage
    const keyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);

    // Store in database
    const result = await query(
      `INSERT INTO api_keys (key_hash, key_prefix, description)
       VALUES ($1, $2, $3)
       RETURNING id, key_prefix, description, created_at`,
      [keyHash, keyPrefix, description]
    );

    return {
      success: true,
      apiKey: apiKey,  // Return this ONCE - user must save it
      keyId: result.rows[0].id,
      keyPrefix: result.rows[0].key_prefix,
      description: result.rows[0].description,
      createdAt: result.rows[0].created_at
    };
  } catch (error) {
    console.error('Error generating API key:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Verify an API key against stored hashes
 * @param {string} apiKey - API key to verify
 * @returns {Promise<object|null>} API key info if valid, null otherwise
 */
export async function verifyApiKey(apiKey) {
  if (!apiKey) {
    console.log('[AUTH] verifyApiKey called with no key');
    return null;
  }

  const keyPrefix = apiKey.substring(0, 8);

  try {
    // Get all non-revoked API keys
    const result = await query(
      'SELECT id, key_hash, key_prefix, description FROM api_keys WHERE revoked = false'
    );

    console.log(`[AUTH] Found ${result.rows.length} active API keys in database`);

    if (result.rows.length === 0) {
      console.log('[AUTH] No API keys in database! Generate one with: node database/bootstrap-apikey.js');
      return null;
    }

    // Check each key hash (bcrypt compare)
    for (const row of result.rows) {
      console.log(`[AUTH] Comparing against key ${row.key_prefix} (${row.description || 'no description'})`);
      const match = await bcrypt.compare(apiKey, row.key_hash);

      if (match) {
        console.log(`[AUTH] Match found for key ${row.key_prefix}`);
        // Update last_used_at timestamp
        await query(
          'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
          [row.id]
        );

        return {
          id: row.id,
          keyPrefix: row.key_prefix,
          description: row.description
        };
      }
    }

    console.log(`[AUTH] No match found for key prefix ${keyPrefix}`);
    return null;
  } catch (error) {
    console.error('[AUTH] Error verifying API key:', error.message);
    console.error('[AUTH] Stack trace:', error.stack);
    return null;
  }
}

/**
 * Express middleware for API key authentication
 * Checks X-API-Key header
 */
export function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const clientIp = req.ip || req.connection.remoteAddress;
  const endpoint = `${req.method} ${req.path}`;

  if (!apiKey) {
    console.log(`[AUTH FAILED] Missing API key - IP: ${clientIp}, Endpoint: ${endpoint}`);
    return res.status(401).json({
      success: false,
      error: 'Missing API key. Provide X-API-Key header.'
    });
  }

  // Log the key prefix for debugging (first 8 chars only)
  const keyPrefix = apiKey.substring(0, 8);
  console.log(`[AUTH ATTEMPT] Key prefix: ${keyPrefix}, IP: ${clientIp}, Endpoint: ${endpoint}`);

  verifyApiKey(apiKey)
    .then(keyInfo => {
      if (!keyInfo) {
        console.log(`[AUTH FAILED] Invalid API key - Prefix: ${keyPrefix}, IP: ${clientIp}, Endpoint: ${endpoint}`);
        return res.status(401).json({
          success: false,
          error: 'Invalid API key'
        });
      }

      console.log(`[AUTH SUCCESS] Key: ${keyInfo.keyPrefix} (${keyInfo.description || 'No description'}), IP: ${clientIp}, Endpoint: ${endpoint}`);

      // Attach key info to request for later use
      req.apiKey = keyInfo;
      next();
    })
    .catch(error => {
      console.error(`[AUTH ERROR] Exception during verification - Key prefix: ${keyPrefix}, IP: ${clientIp}, Error:`, error.message);
      return res.status(500).json({
        success: false,
        error: 'Authentication service error'
      });
    });
}

/**
 * List all API keys (without revealing the actual keys)
 * @returns {Promise<object>} List of API keys
 */
export async function listApiKeys() {
  try {
    const result = await query(
      `SELECT id, key_prefix, description, created_at, last_used_at, revoked
       FROM api_keys
       ORDER BY created_at DESC`
    );

    return {
      success: true,
      keys: result.rows
    };
  } catch (error) {
    console.error('Error listing API keys:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Revoke an API key
 * @param {number} keyId - API key ID to revoke
 * @returns {Promise<object>} Result
 */
export async function revokeApiKey(keyId) {
  try {
    const result = await query(
      'UPDATE api_keys SET revoked = true WHERE id = $1 RETURNING id',
      [keyId]
    );

    if (result.rowCount === 0) {
      return { success: false, error: 'API key not found' };
    }

    return { success: true, revokedId: keyId };
  } catch (error) {
    console.error('Error revoking API key:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Delete an API key permanently
 * @param {number} keyId - API key ID to delete
 * @returns {Promise<object>} Result
 */
export async function deleteApiKey(keyId) {
  try {
    const result = await query(
      'DELETE FROM api_keys WHERE id = $1 RETURNING id',
      [keyId]
    );

    if (result.rowCount === 0) {
      return { success: false, error: 'API key not found' };
    }

    return { success: true, deletedId: keyId };
  } catch (error) {
    console.error('Error deleting API key:', error.message);
    return { success: false, error: error.message };
  }
}

export default {
  generateApiKey,
  verifyApiKey,
  requireApiKey,
  listApiKeys,
  revokeApiKey,
  deleteApiKey
};
