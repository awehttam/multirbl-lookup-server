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
    this.udpServer = null;
    this.tcpServer = null;
    this.db = getDatabase();
    this.rblServers = [];
    this.rblServersList = []; // Array of all RBL servers
    this.customRblConfig = null; // Custom RBL configuration
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
      console.log(`Custom RBL enabled: ${this.customRblConfig.zone_name}`);
      // Add custom RBL to the server map for DNS lookups
      this.rblServers[this.customRblConfig.zone_name] = {
        name: 'Custom RBL',
        host: this.customRblConfig.zone_name,
        description: this.customRblConfig.description || 'Custom blocklist'
      };
    }

    console.log(`Loaded ${Object.keys(this.rblServers).length} RBL servers`);
    console.log(`Multi-RBL lookup domain: ${this.multiRblDomain}`);
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
  parseMultiRblIp(query) {
    // Remove the multi-RBL domain from the query
    if (!query.endsWith(`.${this.multiRblDomain}`)) {
      return null;
    }

    const prefix = query.replace(`.${this.multiRblDomain}`, '');
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
   * Perform multi-RBL lookup for an IP with 250ms timeout
   */
  async performMultiRblLookup(ip, response, queryName, queryType) {
    console.log(`Multi-RBL lookup for ${ip} (250ms timeout)`);
    const startTime = Date.now();

    // Create a timeout promise that resolves after 250ms
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), 250);
    });

    // Start all RBL lookups concurrently
    const lookupPromises = this.rblServersList.map(server =>
      lookupSingleRblWithCache(ip, server, this.db)
    );

    // Race between all lookups completing and the 250ms timeout
    const raceResult = await Promise.race([
      Promise.allSettled(lookupPromises),
      timeoutPromise
    ]);

    const elapsed = Date.now() - startTime;
    let results = [];
    let completedCount = 0;
    let timedOut = false;

    if (raceResult === 'timeout') {
      // Timeout occurred - collect results that have completed so far
      timedOut = true;
      // Wait a tiny bit more for any results that finished just as timeout hit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Use allSettled to get whatever completed
      const settledResults = await Promise.allSettled(
        lookupPromises.map(p => Promise.race([p, Promise.resolve(null)]))
      );

      results = settledResults
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => r.value);

      completedCount = results.length;
    } else {
      // All lookups completed within timeout
      results = raceResult
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
      completedCount = results.length;
    }

    // Count listed servers
    const listedCount = results.filter(r => r.listed).length;
    const totalCount = this.rblServersList.length;

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

      console.log(`  -> LISTED on ${listedCount}/${completedCount} RBLs (${completedCount}/${totalCount} completed in ${elapsed}ms)${timedOut ? ' [TIMEOUT]' : ''}`);
    } else {
      // Not listed on any RBL checked - respond with NXDOMAIN
      response.header.rcode = dns.consts.NAME_TO_RCODE.NOTFOUND;
      console.log(`  -> NOT LISTED (${completedCount}/${totalCount} checked in ${elapsed}ms)${timedOut ? ' [TIMEOUT]' : ''}`);
    }
  }

  /**
   * Handle DNS query
   */
  async handleQuery(request, response) {
    const question = request.question[0];
    const queryName = question.name;
    const queryType = question.type;

    console.log(`Query: ${queryName} (${dns.consts.qtypeToName(queryType)})`);

    // Check if this is a multi-RBL lookup query
    if (queryName.endsWith(`.${this.multiRblDomain}`)) {
      const ip = this.parseMultiRblIp(queryName);
      if (ip) {
        await this.performMultiRblLookup(ip, response, queryName, queryType);
        console.log(`  -> Sending response...`);
        response.send();
        console.log(`  -> Response sent`);
        return;
      }
    }

    // Only handle A record queries for regular RBL lookups
    if (queryType !== dns.consts.NAME_TO_QTYPE.A) {
      console.log(`Skipping non-A record query type: ${dns.consts.qtypeToName(queryType)}`);
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
      console.log(`Not an RBL query or invalid IP, forwarding: ${queryName}`);
      return this.forwardQuery(request, response);
    }

    try {
      const rblServer = this.rblServers[rblHost];
      console.log(`RBL query for ${ip} against ${rblServer.name}${isCustomRbl ? ' [CUSTOM]' : ''}`);

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

        console.log(`  -> LISTED (${responseIp})${isCustomRbl ? ` [${result.reason || 'No reason'}]` : ''} ${result.fromCache ? '[CACHED]' : '[FRESH]'}`);
      } else if (result.error) {
        // Error occurred - respond with SERVFAIL
        console.log(`  -> ERROR: ${result.error} ${result.fromCache ? '[CACHED]' : '[FRESH]'}`);
        response.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL;
      } else {
        // Not listed - respond with NXDOMAIN
        console.log(`  -> NOT LISTED ${result.fromCache ? '[CACHED]' : '[FRESH]'}`);
        response.header.rcode = dns.consts.NAME_TO_RCODE.NOTFOUND;
      }

      console.log(`  -> Sending response...`);
      response.send();
      console.log(`  -> Response sent`);
    } catch (error) {
      console.error(`Error handling query: ${error.message}`);
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
        console.error(`Upstream DNS error: ${err.message}`);
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
      console.log(`\n==> Received ${protocol} request from ${request.address.address}:${request.address.port}`);
      this.handleQuery(request, response).catch(err => {
        console.error(`Error handling request: ${err.message}`);
        console.error(err.stack);
        response.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL;
        response.send();
      });
    });

    server.on('error', (err) => {
      console.error(`DNS ${protocol} Server error: ${err.message}`);
      console.error(err.stack);
    });

    server.on('listening', () => {
      console.log(`DNS ${protocol} server is now listening on ${this.host}:${this.port}`);
    });

    server.on('socketError', (err, socket) => {
      console.error(`${protocol} Socket error: ${err.message}`);
      console.error(err.stack);
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

    console.log(`Starting DNS servers on ${this.host}:${this.port}...`);

    // Start both servers on the same port
    this.udpServer.serve(this.port, this.host);
    this.tcpServer.serve(this.port, this.host);

    console.log(`\nRBL DNS Server started`);
    console.log(`  Listen: ${this.host}:${this.port} (UDP + TCP)`);
    console.log(`  Upstream DNS: ${this.upstreamDns}`);
    console.log(`  Multi-RBL Domain: ${this.multiRblDomain}`);
    console.log(`  Cache: PostgreSQL database`);
    if (this.customRblConfig) {
      console.log(`  Custom RBL: ${this.customRblConfig.zone_name}`);
    }
    console.log(`\nTo test single RBL:`);
    console.log(`  dig @localhost -p ${this.port} 2.0.0.127.zen.spamhaus.org`);
    if (this.customRblConfig) {
      console.log(`\nTo test custom RBL:`);
      console.log(`  dig @localhost -p ${this.port} 1.2.3.4.${this.customRblConfig.zone_name}`);
      console.log(`  dig @localhost -p ${this.port} 1.2.3.4.${this.customRblConfig.zone_name} TXT`);
    }
    console.log(`\nTo test multi-RBL lookup:`);
    console.log(`  dig @localhost -p ${this.port} 2.0.0.127.${this.multiRblDomain}`);
    console.log(`  dig @localhost -p ${this.port} 2.0.0.127.${this.multiRblDomain} TXT\n`);

    // Clean expired cache entries every 5 minutes
    setInterval(async () => {
      const deleted = await this.db.cleanExpired();
      if (deleted > 0) {
        console.log(`Cleaned ${deleted} expired cache entries`);
      }
    }, 5 * 60 * 1000);

    // Log cache stats every hour
    setInterval(async () => {
      const stats = await this.db.getStats();
      console.log(`Cache stats: ${stats.valid} valid, ${stats.expired} expired, ${stats.total} total`);
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
