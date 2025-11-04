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
 * For IPv4: 192.0.2.1 becomes 1.2.0.192
 * For IPv6: expands and reverses nibbles
 */
function reverseIp(ip) {
  // Check if IPv6
  if (ip.includes(':')) {
    // Expand IPv6 address to full form and reverse nibbles
    const expanded = expandIPv6(ip);
    return expanded.replace(/:/g, '').split('').reverse().join('.');
  }
  // IPv4
  return ip.split('.').reverse().join('.');
}

/**
 * Expand IPv6 address to full form
 */
function expandIPv6(ip) {
  // Handle :: shorthand
  if (ip.includes('::')) {
    const parts = ip.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill('0000');
    const full = [...left, ...middle, ...right];
    ip = full.join(':');
  }

  // Expand each segment to 4 digits
  return ip.split(':').map(seg => seg.padStart(4, '0')).join(':');
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
 * Validate IPv6 address
 */
function isValidIpv6(ip) {
  // IPv6 regex pattern
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

  return ipv6Regex.test(ip);
}

/**
 * Validate IP address (IPv4 or IPv6)
 */
function isValidIp(ip) {
  return isValidIpv4(ip) || isValidIpv6(ip);
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
  if (!isValidIp(ip)) {
    throw new Error('Invalid IP address (must be valid IPv4 or IPv6)');
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
