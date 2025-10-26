import dns from 'native-dns';
import { lookupSingleRblWithCache } from './rbl-lookup-cached.js';
import { getDatabase } from './cache-db.js';
import { getRblServers } from './rbl-lookup.js';

/**
 * DNS Server for RBL lookups with caching
 */
class RBLDnsServer {
  constructor(config = {}) {
    this.port = config.port || 8053;
    this.host = config.host || '0.0.0.0';
    this.upstreamDns = config.upstreamDns || '8.8.8.8';
    this.server = null;
    this.db = getDatabase();
    this.rblServers = [];
  }

  /**
   * Initialize the server
   */
  async init() {
    // Load RBL servers from config
    const servers = await getRblServers();
    this.rblServers = servers.reduce((map, server) => {
      map[server.host] = server;
      return map;
    }, {});

    console.log(`Loaded ${Object.keys(this.rblServers).length} RBL servers`);
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
   * Handle DNS query
   */
  async handleQuery(request, response) {
    const question = request.question[0];
    const queryName = question.name;
    const queryType = question.type;

    console.log(`Query: ${queryName} (${dns.consts.qtypeToName(queryType)})`);

    // Only handle A record queries
    if (queryType !== dns.consts.NAME_TO_QTYPE.A) {
      console.log(`Skipping non-A record query type: ${dns.consts.qtypeToName(queryType)}`);
      return this.forwardQuery(request, response);
    }

    // Check if this is an RBL query
    let isRblQuery = false;
    let rblHost = null;
    let ip = null;

    for (const host of Object.keys(this.rblServers)) {
      if (queryName.endsWith(`.${host}`)) {
        isRblQuery = true;
        rblHost = host;
        ip = this.parseReverseIp(queryName, host);
        break;
      }
    }

    if (!isRblQuery || !ip) {
      console.log(`Not an RBL query or invalid IP, forwarding: ${queryName}`);
      return this.forwardQuery(request, response);
    }

    try {
      const rblServer = this.rblServers[rblHost];
      console.log(`RBL query for ${ip} against ${rblServer.name}`);

      const result = await lookupSingleRblWithCache(ip, rblServer, this.db);

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

        console.log(`  -> LISTED (${responseIp}) ${result.fromCache ? '[CACHED]' : '[FRESH]'}`);
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
   * Start the DNS server
   */
  async start() {
    await this.init();

    this.server = dns.createServer();

    this.server.on('request', (request, response) => {
      console.log(`\n==> Received request from ${request.address.address}:${request.address.port}`);
      this.handleQuery(request, response).catch(err => {
        console.error(`Error handling request: ${err.message}`);
        console.error(err.stack);
        response.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL;
        response.send();
      });
    });

    this.server.on('error', (err) => {
      console.error(`DNS Server error: ${err.message}`);
      console.error(err.stack);
    });

    this.server.on('listening', () => {
      console.log(`DNS server is now listening`);
    });

    this.server.on('socketError', (err, socket) => {
      console.error(`Socket error: ${err.message}`);
      console.error(err.stack);
    });

    console.log(`Binding to ${this.host}:${this.port}...`);
    this.server.serve(this.port, this.host);

    console.log(`\nRBL DNS Server started`);
    console.log(`  Listen: ${this.host}:${this.port}`);
    console.log(`  Upstream DNS: ${this.upstreamDns}`);
    console.log(`  Cache: SQLite database`);
    console.log(`\nTo test:`);
    console.log(`  dig @localhost -p ${this.port} 2.0.0.127.zen.spamhaus.org`);
    console.log(`  nslookup 2.0.0.127.zen.spamhaus.org localhost -port=${this.port}\n`);

    // Clean expired cache entries every 5 minutes
    setInterval(() => {
      const deleted = this.db.cleanExpired();
      if (deleted > 0) {
        console.log(`Cleaned ${deleted} expired cache entries`);
      }
    }, 5 * 60 * 1000);

    // Log cache stats every hour
    setInterval(() => {
      const stats = this.db.getStats();
      console.log(`Cache stats: ${stats.valid} valid, ${stats.expired} expired, ${stats.total} total`);
    }, 60 * 60 * 1000);
  }

  /**
   * Stop the DNS server
   */
  stop() {
    if (this.server) {
      this.server.close();
      console.log('DNS server stopped');
    }
    if (this.db) {
      this.db.close();
    }
  }
}

export { RBLDnsServer };
