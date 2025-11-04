#!/usr/bin/env node

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

import { RBLDnsServer } from './dns-server.js';
import { getDatabase } from './cache-db.js';

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    port: 8053,
    host: '0.0.0.0',
    upstreamDns: '8.8.8.8',
    multiRblDomain: 'multi-rbl.example.com',
    multiRblTimeout: 250
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg.startsWith('--port=')) {
      config.port = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--host=')) {
      config.host = arg.split('=')[1];
    } else if (arg.startsWith('--upstream=')) {
      config.upstreamDns = arg.split('=')[1];
    } else if (arg.startsWith('--multi-rbl-domain=')) {
      config.multiRblDomain = arg.split('=')[1];
    } else if (arg.startsWith('--multi-rbl-timeout=')) {
      config.multiRblTimeout = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--stats') {
      showStats();
      process.exit(0);
    } else if (arg === '--clear-cache') {
      clearCache();
      process.exit(0);
    }
  }

  return config;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
RBL DNS Server with SQLite Caching

Usage: node src/start-dns-server.js [options]

Options:
  --port=<port>              DNS server port (default: 8053)
  --host=<host>              DNS server bind address (default: 0.0.0.0)
  --upstream=<dns>           Upstream DNS server for non-RBL queries (default: 8.8.8.8)
  --multi-rbl-domain=<dom>   Domain for multi-RBL lookups (default: multi-rbl.example.com)
  --multi-rbl-timeout=<ms>   Multi-RBL lookup timeout in milliseconds (default: 250)
  --stats                    Show cache statistics and exit
  --clear-cache              Clear all cached entries and exit
  --help, -h                 Show this help message

Examples:
  node src/start-dns-server.js
  node src/start-dns-server.js --port=53 --host=127.0.0.1
  node src/start-dns-server.js --upstream=1.1.1.1
  node src/start-dns-server.js --multi-rbl-domain=check.example.org
  node src/start-dns-server.js --stats

Testing Single RBL:
  dig @localhost -p 8053 2.0.0.127.zen.spamhaus.org
  nslookup 2.0.0.127.zen.spamhaus.org localhost -port=8053

Testing Multi-RBL (checks IP against all RBLs):
  dig @localhost -p 8053 2.0.0.127.multi-rbl.example.com
  dig @localhost -p 8053 2.0.0.127.multi-rbl.example.com TXT
  nslookup 2.0.0.127.multi-rbl.example.com localhost -port=8053

Note: Use port 53 for standard DNS (requires admin/root privileges)
`);
}

/**
 * Show cache statistics
 */
function showStats() {
  const db = getDatabase();
  const stats = db.getStats();

  console.log('\nRBL Cache Statistics');
  console.log('===================');
  console.log(`Total entries:     ${stats.total}`);
  console.log(`Valid entries:     ${stats.valid}`);
  console.log(`Expired entries:   ${stats.expired}`);
  console.log(`Listed:            ${stats.listed}`);
  console.log(`Not listed:        ${stats.notListed}`);
  console.log(`Errors:            ${stats.errors}`);

  if (stats.valid > 0) {
    const hitRate = ((stats.listed / stats.valid) * 100).toFixed(1);
    console.log(`List rate:         ${hitRate}%`);
  }

  db.close();
}

/**
 * Clear cache
 */
function clearCache() {
  const db = getDatabase();
  const deleted = db.clearAll();

  console.log(`\nCleared ${deleted} cache entries`);
  db.close();
}

/**
 * Main function
 */
async function main() {
  const config = parseArgs();

  console.log('Starting RBL DNS Server with caching...\n');

  const server = new RBLDnsServer(config);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    server.stop();
    process.exit(0);
  });

  try {
    await server.start();
  } catch (error) {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

// Run the server
main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
