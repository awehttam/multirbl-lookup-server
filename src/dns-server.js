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

import dns from 'native-dns';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { lookupSingleRblWithCache } from './rbl-lookup-cached.js';
import { getDatabase } from './cache-db.js';
import { getRblServers } from './rbl-lookup.js';
import { getCustomRblConfig, checkCustomRbl } from './custom-rbl-lookup.js';

/**
 * DNS Server for RBL lookups with caching
 */
class RBLDnsServer {
  constructor(config = {}) {
    this.port = config.port || 8053;
    this.host = config.host || '0.0.0.0';
    this.upstreamDns = config.upstreamDns || '8.8.8.8';
    this.multiRblDomain = config.multiRblDomain || 'multi-rbl.example.com';
    this.multiRblTimeout = parseInt(config.multiRblTimeout || process.env.DNS_MULTI_RBL_TIMEOUT || '250', 10);
    this.logLevel = config.logLevel || process.env.DNS_LOG_LEVEL || 'info';
    this.udpServer = null;
    this.tcpServer = null;
    this.db = getDatabase();
    this.rblServers = [];
    this.rblServersList = []; // Array of all RBL servers
    this.customRblConfig = null; // Custom RBL configuration
    this.multiRblZones = []; // Array of multi-RBL zone configurations
  }

  /**
   * Log message based on log level
   * Levels: none, error, info, verbose
   */
  log(message, level = 'info') {
    const levels = { none: 0, error: 1, info: 2, verbose: 3 };
    const currentLevel = levels[this.logLevel] || levels.info;
    const messageLevel = levels[level] || levels.info;

    if (messageLevel <= currentLevel) {
      console.log(message);
    }
  }

  /**
   * Log error message
   */
  logError(message) {
    this.log(message, 'error');
  }

  /**
   * Log verbose message (detailed query info)
   */
  logVerbose(message) {
    this.log(message, 'verbose');
  }

  /**
   * Initialize the server
   */
  async init() {
    // Load RBL servers from config
    const servers = await getRblServers();
    this.rblServersList = servers;
    this.rblServers = servers.reduce((map, server) => {
      map[server.host] = server;
      return map;
    }, {});

    // Load custom RBL configuration
    this.customRblConfig = await getCustomRblConfig();
    if (this.customRblConfig) {
      this.log(`Custom RBL enabled: ${this.customRblConfig.zone_name}`);
      // Add custom RBL to the server map for DNS lookups
      this.rblServers[this.customRblConfig.zone_name] = {
        name: 'Custom RBL',
        host: this.customRblConfig.zone_name,
        description: this.customRblConfig.description || 'Custom blocklist'
      };
    }

    // Load multi-RBL zones configuration
    await this.loadMultiRblZones();

    this.log(`Loaded ${Object.keys(this.rblServers).length} RBL servers`);
    this.log(`Loaded ${this.multiRblZones.length} multi-RBL zone(s)`);
  }

  /**
   * Load multi-RBL zones configuration from file
   */
  async loadMultiRblZones() {
    const configPath = join(process.cwd(), 'etc', 'multi-rbl-zones.json');
    try {
      const data = await readFile(configPath, 'utf8');
      const config = JSON.parse(data);
      this.multiRblZones = config.zones || [];

      // Validate and log each zone
      for (const zone of this.multiRblZones) {
        const rblCount = zone.rbls === '*' ? 'all' : zone.rbls.length;
        this.log(`  Zone: ${zone.domain} (${rblCount} RBLs) - ${zone.description || 'No description'}`);
      }
    } catch (error) {
      // Fall back to single domain from config if file doesn't exist
      if (error.code === 'ENOENT') {
        this.log('No multi-RBL zones config found, using legacy single domain');
      } else {
        this.logError(`Error loading multi-RBL zones config: ${error.message}`);
      }

      // Create default zone using legacy config
      this.multiRblZones = [{
        domain: this.multiRblDomain,
        description: 'Default multi-RBL zone (all RBLs)',
        rbls: '*'
      }];
    }
  }

  /**
   * Parse IP from reverse DNS query
   * e.g., "4.3.2.1.zen.spamhaus.org" -> "1.2.3.4"
   */
  parseReverseIp(query, rblHost) {
    // Remove the RBL host from the query
    const prefix = query.replace(`.${rblHost}`, '');

    // Split by dots and reverse
    const parts = prefix.split('.').reverse();

    // Validate that we have 4 octets
    if (parts.length !== 4) {
      return null;
    }

    // Validate each octet
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) {
        return null;
      }
    }

    return parts.join('.');
  }

  /**
   * Parse IP from multi-RBL domain query
   * e.g., "2.0.0.127.multi-rbl.example.com" -> "127.0.0.2"
   */
  parseMultiRblIp(query, domain) {
    // Remove the multi-RBL domain from the query
    if (!query.endsWith(`.${domain}`)) {
      return null;
    }

    const prefix = query.replace(`.${domain}`, '');
    const parts = prefix.split('.');

    // Validate that we have 4 octets
    if (parts.length !== 4) {
      return null;
    }

    // Validate each octet
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) {
        return null;
      }
    }

    // Reverse the IP (DNS blacklist format)
    return parts.reverse().join('.');
  }

  /**
   * Perform multi-RBL lookup for an IP with configurable timeout
   */
  async performMultiRblLookup(ip, response, queryName, queryType, zoneConfig) {
    this.logVerbose(`Multi-RBL lookup for ${ip} on zone ${zoneConfig.domain} (${this.multiRblTimeout}ms timeout)`);
    const startTime = Date.now();

    // Track completed results and cache statistics
    const completedResults = [];
    let settledCount = 0;
    let cacheHits = 0;
    let cacheMisses = 0;

    // Filter RBL list based on zone configuration
    const rblsToCheck = zoneConfig.rbls === '*'
      ? this.rblServersList
      : this.rblServersList.filter(server => zoneConfig.rbls.includes(server.host));

    this.logVerbose(`Checking ${rblsToCheck.length} RBLs for this zone`);

    // Start all RBL lookups concurrently and track completions
    const lookupPromises = rblsToCheck.map(async (server) => {
      try {
        const result = await lookupSingleRblWithCache(ip, server, this.db);
        completedResults.push(result);
        settledCount++;

        // Track cache hits/misses
        if (result.fromCache) {
          cacheHits++;
        } else {
          cacheMisses++;
        }

        return result;
      } catch (error) {
        settledCount++;
        return null;
      }
    });

    // Create a timeout promise that resolves after configured timeout
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), this.multiRblTimeout);
    });

    // Race between all lookups completing and the 250ms timeout
    const raceResult = await Promise.race([
      Promise.allSettled(lookupPromises),
      timeoutPromise
    ]);

    const elapsed = Date.now() - startTime;
    let timedOut = false;

    if (raceResult === 'timeout') {
      // Timeout occurred - use whatever results have completed so far
      timedOut = true;
      this.log(`  -> Timeout hit: ${completedResults.length} results completed (${cacheHits} cache hits, ${cacheMisses} DNS queries)`);
    } else {
      // All lookups completed within timeout
      this.log(`  -> All ${settledCount} lookups completed within timeout (${cacheHits} cache hits, ${cacheMisses} DNS queries)`);
    }

    // Filter out null results (errors)
    const results = completedResults.filter(r => r !== null);
    const completedCount = results.length;

    // Count listed servers
    const listedCount = results.filter(r => r.listed).length;
    const totalCount = rblsToCheck.length;

    response.header.qr = 1; // This is a response
    response.header.aa = 1; // Authoritative answer
    response.header.ra = 0; // Recursion not available

    if (listedCount > 0) {
      // Return different responses based on query type
      if (queryType === dns.consts.NAME_TO_QTYPE.TXT) {
        // TXT query - return summary and list of RBLs
        const summary = `Listed on ${listedCount}/${completedCount} RBLs (${completedCount}/${totalCount} checked in ${elapsed}ms)`;
        response.answer.push(dns.TXT({
          name: queryName,
          data: [summary],  // Must be array of strings
          ttl: 300
        }));

        // Add TXT records for each listing (limit to 5 to avoid DNS packet size issues)
        const listedResults = results.filter(r => r.listed);
        const maxTxtRecords = 5;
        const txtRecordsToAdd = listedResults.slice(0, maxTxtRecords);

        txtRecordsToAdd.forEach(result => {
          const txtData = `${result.name}: LISTED`;
          response.answer.push(dns.TXT({
            name: queryName,
            data: [txtData],  // Must be array of strings
            ttl: 300
          }));
        });

        // If there are more than maxTxtRecords, add a note
        if (listedResults.length > maxTxtRecords) {
          response.answer.push(dns.TXT({
            name: queryName,
            data: [`... and ${listedResults.length - maxTxtRecords} more (${maxTxtRecords}/${listedResults.length} shown)`],  // Must be array
            ttl: 300
          }));
        }
      } else {
        // A record query - just return the IP
        response.answer.push(dns.A({
          name: queryName,
          address: '127.0.0.2',
          ttl: 300
        }));
      }

      this.log(`  -> LISTED on ${listedCount}/${completedCount} RBLs (${completedCount}/${totalCount} completed in ${elapsed}ms)${timedOut ? ' [TIMEOUT]' : ''}`);
    } else {
      // Not listed on any RBL checked - respond with NXDOMAIN
      response.header.rcode = dns.consts.NAME_TO_RCODE.NOTFOUND;
      this.log(`  -> NOT LISTED (${completedCount}/${totalCount} checked in ${elapsed}ms)${timedOut ? ' [TIMEOUT]' : ''}`);
    }
  }

  /**
   * Handle DNS query
   */
  async handleQuery(request, response) {
    const question = request.question[0];
    const queryName = question.name;
    const queryType = question.type;

    this.logVerbose(`Query: ${queryName} (${dns.consts.qtypeToName(queryType)})`);

    // Check if this is a multi-RBL lookup query for any configured zone
    let matchedZone = null;
    for (const zone of this.multiRblZones) {
      if (queryName.endsWith(`.${zone.domain}`)) {
        matchedZone = zone;
        break;
      }
    }

    if (matchedZone) {
      const ip = this.parseMultiRblIp(queryName, matchedZone.domain);
      if (ip) {
        await this.performMultiRblLookup(ip, response, queryName, queryType, matchedZone);
        this.logVerbose(`  -> Sending response...`);
        response.send();
        this.logVerbose(`  -> Response sent`);
        return;
      }
    }

    // Only handle A record queries for regular RBL lookups
    if (queryType !== dns.consts.NAME_TO_QTYPE.A) {
      this.logVerbose(`Skipping non-A record query type: ${dns.consts.qtypeToName(queryType)}`);
      return this.forwardQuery(request, response);
    }

    // Check if this is an RBL query
    let isRblQuery = false;
    let rblHost = null;
    let ip = null;
    let isCustomRbl = false;

    for (const host of Object.keys(this.rblServers)) {
      if (queryName.endsWith(`.${host}`)) {
        isRblQuery = true;
        rblHost = host;
        ip = this.parseReverseIp(queryName, host);

        // Check if this is the custom RBL
        if (this.customRblConfig && host === this.customRblConfig.zone_name) {
          isCustomRbl = true;
        }
        break;
      }
    }

    if (!isRblQuery || !ip) {
      this.logVerbose(`Not an RBL query or invalid IP, forwarding: ${queryName}`);
      return this.forwardQuery(request, response);
    }

    try {
      const rblServer = this.rblServers[rblHost];
      this.logVerbose(`RBL query for ${ip} against ${rblServer.name}${isCustomRbl ? ' [CUSTOM]' : ''}`);

      let result;

      if (isCustomRbl) {
        // Use custom RBL lookup
        result = await checkCustomRbl(ip, rblHost);
      } else {
        // Use standard RBL lookup with cache
        result = await lookupSingleRblWithCache(ip, rblServer, this.db);
      }

      response.header.qr = 1; // This is a response
      response.header.aa = 1; // Authoritative answer
      response.header.ra = 0; // Recursion not available

      if (result.listed) {
        // IP is listed - respond with the RBL response IP (usually 127.0.0.x)
        const responseIp = result.response || '127.0.0.2';

        response.answer.push(dns.A({
          name: queryName,
          address: responseIp,
          ttl: result.ttl || 3600
        }));

        // Add TXT record with reason for custom RBL
        if (isCustomRbl && result.reason) {
          response.answer.push(dns.TXT({
            name: queryName,
            data: [result.reason],  // Must be array of strings
            ttl: 3600
          }));
        }

        const cacheInfo = result.fromCache ? `[CACHED:${result.cacheSource || 'unknown'}]` : '[DNS]';
        this.logVerbose(`  -> LISTED (${responseIp})${isCustomRbl ? ` [${result.reason || 'No reason'}]` : ''} ${cacheInfo}`);
      } else if (result.error) {
        // Error occurred - respond with SERVFAIL
        const cacheInfo = result.fromCache ? `[CACHED:${result.cacheSource || 'unknown'}]` : '[DNS]';
        this.logVerbose(`  -> ERROR: ${result.error} ${cacheInfo}`);
        response.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL;
      } else {
        // Not listed - respond with NXDOMAIN
        const cacheInfo = result.fromCache ? `[CACHED:${result.cacheSource || 'unknown'}]` : '[DNS]';
        this.logVerbose(`  -> NOT LISTED ${cacheInfo}`);
        response.header.rcode = dns.consts.NAME_TO_RCODE.NOTFOUND;
      }

      this.logVerbose(`  -> Sending response...`);
      response.send();
      this.logVerbose(`  -> Response sent`);
    } catch (error) {
      this.logError(`Error handling query: ${error.message}`);
      response.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL;
      response.send();
    }
  }

  /**
   * Forward non-RBL queries to upstream DNS
   */
  forwardQuery(request, response) {
    const question = request.question[0];

    const upstreamRequest = dns.Request({
      question: question,
      server: { address: this.upstreamDns, port: 53, type: 'udp' },
      timeout: 5000
    });

    upstreamRequest.on('message', (err, msg) => {
      if (err) {
        this.logError(`Upstream DNS error: ${err.message}`);
        response.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL;
        response.send();
        return;
      }

      // Copy answers from upstream
      msg.answer.forEach(a => response.answer.push(a));
      msg.authority.forEach(a => response.authority.push(a));
      msg.additional.forEach(a => response.additional.push(a));

      response.send();
    });

    upstreamRequest.send();
  }

  /**
   * Attach event handlers to a DNS server (UDP or TCP)
   */
  attachServerHandlers(server, protocol) {
    server.on('request', (request, response) => {
      this.logVerbose(`\n==> Received ${protocol} request from ${request.address.address}:${request.address.port}`);
      this.handleQuery(request, response).catch(err => {
        this.logError(`Error handling request: ${err.message}`);
        this.logError(err.stack);
        response.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL;
        response.send();
      });
    });

    server.on('error', (err) => {
      this.logError(`DNS ${protocol} Server error: ${err.message}`);
      this.logError(err.stack);
    });

    server.on('listening', () => {
      this.log(`DNS ${protocol} server is now listening on ${this.host}:${this.port}`);
    });

    server.on('socketError', (err, socket) => {
      this.logError(`${protocol} Socket error: ${err.message}`);
      this.logError(err.stack);
    });
  }

  /**
   * Start the DNS server (both UDP and TCP)
   */
  async start() {
    await this.init();

    // Create UDP server
    this.udpServer = dns.createUDPServer();
    this.attachServerHandlers(this.udpServer, 'UDP');

    // Create TCP server
    this.tcpServer = dns.createTCPServer();
    this.attachServerHandlers(this.tcpServer, 'TCP');

    this.log(`Starting DNS servers on ${this.host}:${this.port}...`);

    // Start both servers on the same port
    this.udpServer.serve(this.port, this.host);
    this.tcpServer.serve(this.port, this.host);

    this.log(`\nRBL DNS Server started`);
    this.log(`  Listen: ${this.host}:${this.port} (UDP + TCP)`);
    this.log(`  Upstream DNS: ${this.upstreamDns}`);
    this.log(`  Multi-RBL Zones: ${this.multiRblZones.length} zone(s)`);
    for (const zone of this.multiRblZones) {
      const rblCount = zone.rbls === '*' ? 'all' : zone.rbls.length;
      this.log(`    - ${zone.domain} (${rblCount} RBLs)`);
    }
    this.log(`  Multi-RBL Timeout: ${this.multiRblTimeout}ms`);
    this.log(`  Log Level: ${this.logLevel}`);
    this.log(`  Cache: PostgreSQL database`);
    if (this.customRblConfig) {
      this.log(`  Custom RBL: ${this.customRblConfig.zone_name}`);
    }
    this.log(`\nTo test single RBL:`);
    this.log(`  dig @localhost -p ${this.port} 2.0.0.127.zen.spamhaus.org`);
    if (this.customRblConfig) {
      this.log(`\nTo test custom RBL:`);
      this.log(`  dig @localhost -p ${this.port} 1.2.3.4.${this.customRblConfig.zone_name}`);
      this.log(`  dig @localhost -p ${this.port} 1.2.3.4.${this.customRblConfig.zone_name} TXT`);
    }
    this.log(`\nTo test multi-RBL lookup:`);
    for (const zone of this.multiRblZones) {
      this.log(`  dig @localhost -p ${this.port} 2.0.0.127.${zone.domain}`);
      this.log(`  dig @localhost -p ${this.port} 2.0.0.127.${zone.domain} TXT`);
    }

    // Clean expired cache entries every 5 minutes
    setInterval(async () => {
      const deleted = await this.db.cleanExpired();
      if (deleted > 0) {
        this.log(`Cleaned ${deleted} expired cache entries`);
      }
    }, 5 * 60 * 1000);

    // Log cache stats every hour
    setInterval(async () => {
      const stats = await this.db.getStats();
      this.log(`Cache stats: ${stats.valid} valid, ${stats.expired} expired, ${stats.total} total`);
    }, 60 * 60 * 1000);
  }

  /**
   * Stop the DNS servers (both UDP and TCP)
   */
  stop() {
    if (this.udpServer) {
      this.udpServer.close();
      console.log('DNS UDP server stopped');
    }
    if (this.tcpServer) {
      this.tcpServer.close();
      console.log('DNS TCP server stopped');
    }
    if (this.db) {
      this.db.close();
    }
  }
}

export { RBLDnsServer };
