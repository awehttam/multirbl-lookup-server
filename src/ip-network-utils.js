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
 * IP Network Utilities for CIDR matching (IPv4 and IPv6)
 */

/**
 * Convert IPv4 address to 32-bit integer
 */
function ipv4ToInt(ip) {
  const parts = ip.split('.');
  return (
    (parseInt(parts[0], 10) << 24) +
    (parseInt(parts[1], 10) << 16) +
    (parseInt(parts[2], 10) << 8) +
    parseInt(parts[3], 10)
  ) >>> 0; // Convert to unsigned
}

/**
 * Check if IPv4 address is in CIDR network
 */
function isIpv4InCidr(ip, cidr) {
  const [network, prefixLen] = cidr.split('/');
  const prefix = parseInt(prefixLen, 10);

  if (prefix < 0 || prefix > 32) {
    return false;
  }

  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);

  // Create mask: shift 32-prefix bits from right
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  return (ipInt & mask) === (networkInt & mask);
}

/**
 * Expand IPv6 address to full form (8 groups of 4 hex digits)
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
 * Convert IPv6 address to BigInt
 */
function ipv6ToBigInt(ip) {
  const expanded = expandIPv6(ip);
  const hex = expanded.replace(/:/g, '');
  return BigInt('0x' + hex);
}

/**
 * Check if IPv6 address is in CIDR network
 */
function isIpv6InCidr(ip, cidr) {
  const [network, prefixLen] = cidr.split('/');
  const prefix = parseInt(prefixLen, 10);

  if (prefix < 0 || prefix > 128) {
    return false;
  }

  const ipBigInt = ipv6ToBigInt(ip);
  const networkBigInt = ipv6ToBigInt(network);

  // Create mask: shift 128-prefix bits from right
  const mask = prefix === 0 ? 0n : (~0n << BigInt(128 - prefix));

  return (ipBigInt & mask) === (networkBigInt & mask);
}

/**
 * Detect if IP is IPv4 or IPv6
 */
function isIPv6(ip) {
  return ip.includes(':');
}

/**
 * Check if IP address is in any of the allowed networks
 * @param {string} ip - IP address to check
 * @param {string[]} allowedNetworks - Array of CIDR networks
 * @returns {boolean} - True if IP is in any allowed network
 */
export function isIpAllowed(ip, allowedNetworks) {
  if (!allowedNetworks || allowedNetworks.length === 0) {
    // No restrictions - allow all
    return true;
  }

  const isIpv6Address = isIPv6(ip);

  for (const cidr of allowedNetworks) {
    const isCidrIPv6 = isIPv6(cidr.split('/')[0]);

    // Skip if IP version doesn't match CIDR version
    if (isIpv6Address !== isCidrIPv6) {
      continue;
    }

    try {
      if (isIpv6Address) {
        if (isIpv6InCidr(ip, cidr)) {
          return true;
        }
      } else {
        if (isIpv4InCidr(ip, cidr)) {
          return true;
        }
      }
    } catch (error) {
      // Invalid CIDR format - skip it
      console.error(`Invalid CIDR format: ${cidr}`, error.message);
      continue;
    }
  }

  return false;
}

/**
 * Validate CIDR notation
 * @param {string} cidr - CIDR notation (e.g., "192.168.1.0/24")
 * @returns {boolean} - True if valid
 */
export function isValidCidr(cidr) {
  if (!cidr || typeof cidr !== 'string') {
    return false;
  }

  const parts = cidr.split('/');
  if (parts.length !== 2) {
    return false;
  }

  const [network, prefixLen] = parts;
  const prefix = parseInt(prefixLen, 10);

  if (isNaN(prefix)) {
    return false;
  }

  const isIpv6Network = isIPv6(network);

  if (isIpv6Network) {
    // IPv6
    if (prefix < 0 || prefix > 128) {
      return false;
    }
    // Basic IPv6 validation
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    return ipv6Regex.test(network);
  } else {
    // IPv4
    if (prefix < 0 || prefix > 32) {
      return false;
    }
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(network)) {
      return false;
    }
    const octets = network.split('.');
    return octets.every(octet => {
      const num = parseInt(octet, 10);
      return num >= 0 && num <= 255;
    });
  }
}

export default {
  isIpAllowed,
  isValidCidr
};
