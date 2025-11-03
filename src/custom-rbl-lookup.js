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

/**
 * Custom RBL Lookup Implementation
 * Checks if an IP address is in the custom blocklist using PostgreSQL CIDR matching
 */

import { query } from './db-postgres.js';

/**
 * Get custom RBL configuration
 * @returns {Promise<object|null>} Configuration object or null if not configured
 */
export async function getCustomRblConfig() {
  try {
    const result = await query(
      'SELECT zone_name, description, enabled FROM custom_rbl_config WHERE enabled = true LIMIT 1'
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error getting custom RBL config:', error.message);
    return null;
  }
}

/**
 * Check if an IP address is in the custom RBL
 * Uses PostgreSQL's >>= operator for CIDR containment check
 *
 * @param {string} ip - IP address to check (IPv4 or IPv6)
 * @param {string} zoneName - Zone name (optional, for validation)
 * @returns {Promise<object>} Lookup result
 */
export async function checkCustomRbl(ip, zoneName = null) {
  try {
    // Check if custom RBL is enabled
    const config = await getCustomRblConfig();

    if (!config) {
      return {
        listed: false,
        response: null,
        reason: null,
        error: 'Custom RBL not configured or disabled'
      };
    }

    // Validate zone name if provided
    if (zoneName && zoneName !== config.zone_name) {
      return {
        listed: false,
        response: null,
        reason: null,
        error: `Invalid zone name: ${zoneName}`
      };
    }

    // Query for matching CIDR entries using containment operator
    // The >>= operator checks if the network contains the IP
    const result = await query(
      `SELECT id, network::text, reason, created_at
       FROM custom_rbl_entries
       WHERE listed = true AND network >>= $1::inet
       ORDER BY masklen(network) DESC
       LIMIT 1`,
      [ip]
    );

    if (result.rows.length === 0) {
      return {
        listed: false,
        response: null,
        reason: null,
        error: null
      };
    }

    const entry = result.rows[0];

    return {
      listed: true,
      response: '127.0.0.2', // Standard RBL response for listed IPs
      reason: entry.reason || 'Listed in custom blocklist',
      network: entry.network,
      entryId: entry.id,
      createdAt: entry.created_at,
      error: null
    };

  } catch (error) {
    console.error('Error checking custom RBL:', error.message);
    return {
      listed: false,
      response: null,
      reason: null,
      error: error.message
    };
  }
}

/**
 * Add an entry to the custom RBL
 * @param {string} network - CIDR notation (e.g., '192.168.1.0/24' or '10.0.0.1/32')
 * @param {string} reason - Reason for listing
 * @param {string} addedBy - Identifier of who added it
 * @returns {Promise<object>} Result with id or error
 */
export async function addCustomRblEntry(network, reason = null, addedBy = 'api') {
  try {
    const result = await query(
      `INSERT INTO custom_rbl_entries (network, reason, added_by, listed)
       VALUES ($1::cidr, $2, $3, true)
       RETURNING id, network::text, reason, created_at`,
      [network, reason, addedBy]
    );

    return {
      success: true,
      entry: {
        id: result.rows[0].id,
        network: result.rows[0].network,
        reason: result.rows[0].reason,
        createdAt: result.rows[0].created_at
      }
    };
  } catch (error) {
    console.error('Error adding custom RBL entry:', error.message);

    // Check for specific error types
    if (error.code === '23505') {
      return { success: false, error: 'Entry already exists' };
    } else if (error.code === '22P02') {
      return { success: false, error: 'Invalid CIDR notation' };
    }

    return { success: false, error: error.message };
  }
}

/**
 * Remove an entry from the custom RBL
 * @param {number} entryId - Entry ID to remove
 * @returns {Promise<object>} Result indicating success or failure
 */
export async function removeCustomRblEntry(entryId) {
  try {
    const result = await query(
      'DELETE FROM custom_rbl_entries WHERE id = $1 RETURNING id',
      [entryId]
    );

    if (result.rowCount === 0) {
      return { success: false, error: 'Entry not found' };
    }

    return { success: true, deletedId: entryId };
  } catch (error) {
    console.error('Error removing custom RBL entry:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Remove an entry by CIDR network
 * @param {string} network - CIDR notation
 * @returns {Promise<object>} Result indicating success or failure
 */
export async function removeCustomRblEntryByNetwork(network) {
  try {
    const result = await query(
      'DELETE FROM custom_rbl_entries WHERE network = $1::cidr RETURNING id',
      [network]
    );

    if (result.rowCount === 0) {
      return { success: false, error: 'Entry not found' };
    }

    return { success: true, deletedId: result.rows[0].id };
  } catch (error) {
    console.error('Error removing custom RBL entry by network:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update an entry in the custom RBL
 * @param {number} entryId - Entry ID
 * @param {object} updates - Fields to update (reason, listed)
 * @returns {Promise<object>} Result with updated entry or error
 */
export async function updateCustomRblEntry(entryId, updates) {
  try {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (updates.reason !== undefined) {
      fields.push(`reason = $${paramIndex++}`);
      values.push(updates.reason);
    }

    if (updates.listed !== undefined) {
      fields.push(`listed = $${paramIndex++}`);
      values.push(updates.listed);
    }

    if (fields.length === 0) {
      return { success: false, error: 'No fields to update' };
    }

    values.push(entryId);

    const result = await query(
      `UPDATE custom_rbl_entries
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, network::text, reason, listed, updated_at`,
      values
    );

    if (result.rowCount === 0) {
      return { success: false, error: 'Entry not found' };
    }

    return {
      success: true,
      entry: {
        id: result.rows[0].id,
        network: result.rows[0].network,
        reason: result.rows[0].reason,
        listed: result.rows[0].listed,
        updatedAt: result.rows[0].updated_at
      }
    };
  } catch (error) {
    console.error('Error updating custom RBL entry:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * List all entries in the custom RBL with pagination
 * @param {object} options - Query options (limit, offset, listedOnly)
 * @returns {Promise<object>} Result with entries array
 */
export async function listCustomRblEntries(options = {}) {
  const limit = options.limit || 100;
  const offset = options.offset || 0;
  const listedOnly = options.listedOnly !== false;

  try {
    const whereClause = listedOnly ? 'WHERE listed = true' : '';

    const result = await query(
      `SELECT id, network::text, reason, listed, added_by, created_at, updated_at
       FROM custom_rbl_entries
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM custom_rbl_entries ${whereClause}`
    );

    return {
      success: true,
      entries: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    };
  } catch (error) {
    console.error('Error listing custom RBL entries:', error.message);
    return { success: false, error: error.message, entries: [] };
  }
}

/**
 * Update custom RBL configuration
 * @param {object} config - Configuration fields to update
 * @returns {Promise<object>} Result with updated config or error
 */
export async function updateCustomRblConfig(config) {
  try {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (config.zoneName !== undefined) {
      fields.push(`zone_name = $${paramIndex++}`);
      values.push(config.zoneName);
    }

    if (config.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(config.description);
    }

    if (config.enabled !== undefined) {
      fields.push(`enabled = $${paramIndex++}`);
      values.push(config.enabled);
    }

    if (fields.length === 0) {
      return { success: false, error: 'No fields to update' };
    }

    const result = await query(
      `UPDATE custom_rbl_config
       SET ${fields.join(', ')}
       WHERE id = 1
       RETURNING zone_name, description, enabled, updated_at`
    );

    if (result.rowCount === 0) {
      return { success: false, error: 'Configuration not found' };
    }

    return {
      success: true,
      config: result.rows[0]
    };
  } catch (error) {
    console.error('Error updating custom RBL config:', error.message);

    if (error.code === '23505') {
      return { success: false, error: 'Zone name already exists' };
    }

    return { success: false, error: error.message };
  }
}

export default {
  getCustomRblConfig,
  checkCustomRbl,
  addCustomRblEntry,
  removeCustomRblEntry,
  removeCustomRblEntryByNetwork,
  updateCustomRblEntry,
  listCustomRblEntries,
  updateCustomRblConfig
};
