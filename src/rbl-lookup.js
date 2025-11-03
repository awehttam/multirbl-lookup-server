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

import dns from 'dns/promises';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Reverse an IP address for RBL lookup
 * e.g., 192.168.1.1 becomes 1.1.168.192
 */
function reverseIp(ip) {
  return ip.split('.').reverse().join('.');
}

/**
 * Validate IPv4 address
 */
function isValidIpv4(ip) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) {
    return false;
  }

  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * Perform a single RBL lookup
 */
async function lookupSingleRbl(ip, rblServer, timeout = 5000) {
  const reversedIp = reverseIp(ip);
  const query = `${reversedIp}.${rblServer.host}`;

  const startTime = Date.now();

  try {
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), timeout);
    });

    // Race between DNS lookup and timeout
    const addresses = await Promise.race([
      dns.resolve4(query),
      timeoutPromise
    ]);

    const responseTime = Date.now() - startTime;

    return {
      name: rblServer.name,
      host: rblServer.host,
      description: rblServer.description,
      listed: true,
      response: addresses[0] || null,
      responseTime,
      error: null
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // NXDOMAIN or NOTFOUND means not listed
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return {
        name: rblServer.name,
        host: rblServer.host,
        description: rblServer.description,
        listed: false,
        response: null,
        responseTime,
        error: null
      };
    }

    // Actual error (timeout, network issue, etc.)
    return {
      name: rblServer.name,
      host: rblServer.host,
      description: rblServer.description,
      listed: null,
      response: null,
      responseTime,
      error: error.message
    };
  }
}

/**
 * Load RBL servers from configuration file
 */
async function loadRblServers() {
  const configPath = join(__dirname, '..', 'etc', 'rbl-servers.json');
  const data = await readFile(configPath, 'utf8');
  return JSON.parse(data);
}

/**
 * Lookup an IP address against multiple RBL servers concurrently
 */
export async function lookupIp(ip, onProgress = null) {
  if (!isValidIpv4(ip)) {
    throw new Error('Invalid IPv4 address');
  }

  const rblServers = await loadRblServers();
  const results = [];

  // Create promises for all lookups
  const lookupPromises = rblServers.map(async (server) => {
    const result = await lookupSingleRbl(ip, server);
    results.push(result);

    // Call progress callback if provided
    if (onProgress) {
      onProgress(result, results.length, rblServers.length);
    }

    return result;
  });

  // Wait for all lookups to complete
  await Promise.all(lookupPromises);

  // Sort results: listed first, then errors, then not listed
  results.sort((a, b) => {
    if (a.listed === b.listed) {
      return a.responseTime - b.responseTime;
    }
    if (a.listed === true) return -1;
    if (b.listed === true) return 1;
    if (a.error && !b.error) return -1;
    if (!a.error && b.error) return 1;
    return 0;
  });

  return {
    ip,
    timestamp: new Date().toISOString(),
    totalChecked: rblServers.length,
    listedCount: results.filter(r => r.listed === true).length,
    notListedCount: results.filter(r => r.listed === false).length,
    errorCount: results.filter(r => r.error !== null).length,
    results
  };
}

/**
 * Get list of available RBL servers
 */
export async function getRblServers() {
  return await loadRblServers();
}
